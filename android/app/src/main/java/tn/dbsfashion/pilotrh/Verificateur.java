package tn.dbsfashion.pilotrh;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Vérification périodique des nouveaux messages.
 *
 * Pourquoi ce choix plutôt que Firebase : une vraie notification « poussée »
 * (comme WhatsApp) passe par les serveurs de Google (Firebase Cloud Messaging),
 * ce qui suppose un compte Google, une clé de serveur et les services Google Play
 * sur chaque téléphone. Ici, l'application demande simplement au serveur, toutes
 * les N minutes, s'il y a du nouveau. C'est plus simple, sans dépendance, et sans
 * qu'aucune donnée ne transite par un tiers.
 *
 * La contrepartie, à connaître : le message n'arrive pas dans la seconde, mais
 * au prochain réveil (30 minutes par défaut). Android impose d'ailleurs un
 * minimum d'environ 15 minutes pour les réveils répétés, afin de préserver la
 * batterie.
 */
public class Verificateur extends BroadcastReceiver {

    static final String ACTION = "tn.dbsfashion.pilotrh.VERIFIER";
    static final String CLE_JETON = "jeton";          // relevé depuis la page web
    static final String CLE_VU = "dernier_vu";        // horodatage du dernier message notifié

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        programmer(c);                                // se replanifier quoi qu'il arrive
        if (!Notifs.actif(c)) return;

        final SharedPreferences p = Notifs.prefs(c);
        final String serveur = p.getString("serveur", "");
        final String jeton = p.getString(CLE_JETON, "");
        if (serveur.isEmpty() || jeton.isEmpty()) return;   // pas encore connectée
        if (!reseau(c)) return;

        int heure = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        if (Notifs.enSilence(c, heure)) return;

        new Thread(new Runnable() {
            @Override public void run() { interroger(c, p, serveur, jeton); }
        }).start();
    }

    private static boolean reseau(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo n = cm.getActiveNetworkInfo();
            return n != null && n.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    /** Appel du point /api/me/nouveautes : volontairement minuscule. */
    private static void interroger(Context c, SharedPreferences p, String serveur, String jeton) {
        HttpURLConnection co = null;
        try {
            co = (HttpURLConnection) new URL(serveur + "/api/me/nouveautes").openConnection();
            co.setRequestMethod("POST");
            co.setConnectTimeout(15000);
            co.setReadTimeout(20000);
            co.setDoOutput(true);
            co.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            OutputStream os = co.getOutputStream();
            os.write(("{\"t\":\"" + jeton.replace("\"", "") + "\"}").getBytes("UTF-8"));
            os.close();
            if (co.getResponseCode() != 200) return;

            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(co.getInputStream(), "UTF-8"));
            String l;
            while ((l = r.readLine()) != null) sb.append(l);
            r.close();

            String rep = sb.toString();
            int messages = entier(rep, "messages");
            int sondages = entier(rep, "sondages");
            if (messages + sondages <= 0) { Notifs.effacer(c); return; }

            // on ne re-notifie pas le même message à chaque réveil : sans cela,
            // le téléphone sonnerait toutes les 30 minutes jusqu'à l'ouverture
            String horodatage = texte(rep, "ts");
            String signature = horodatage + "|" + messages + "|" + sondages;
            if (signature.equals(p.getString(CLE_VU, ""))) return;
            p.edit().putString(CLE_VU, signature).apply();

            Notifs.afficher(c, messages, sondages, texte(rep, "titre"), texte(rep, "apercu"),
                    rep.contains("\"important\": true") || rep.contains("\"important\":true"));
        } catch (Exception e) {
            Log.i("PilotRH", "verification impossible : " + e);
        } finally {
            if (co != null) co.disconnect();
        }
    }

    /* Deux extracteurs minuscules : ajouter une bibliothèque JSON pour lire quatre
       champs ferait grossir l'application sans rien apporter. */
    static int entier(String json, String cle) {
        String v = brut(json, cle);
        if (v == null) return 0;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return 0; }
    }

    static String texte(String json, String cle) {
        String v = brut(json, cle);
        if (v == null) return "";
        v = v.trim();
        if (v.startsWith("\"")) {
            int fin = v.length() - 1;
            while (fin > 0 && v.charAt(fin) != '"') fin--;
            v = v.substring(1, Math.max(1, fin));
        }
        return v.replace("\\\"", "\"").replace("\\n", "\n").replace("\\/", "/");
    }

    private static String brut(String json, String cle) {
        if (json == null) return null;
        String marque = "\"" + cle + "\"";
        int i = json.indexOf(marque);
        if (i < 0) return null;
        i = json.indexOf(':', i + marque.length());
        if (i < 0) return null;
        int j = i + 1;
        boolean chaine = false;
        while (j < json.length()) {
            char ch = json.charAt(j);
            if (ch == '"' && json.charAt(j - 1) != '\\') {
                if (chaine) { j++; break; }
                chaine = true;
            } else if (!chaine && (ch == ',' || ch == '}')) {
                break;
            }
            j++;
        }
        return json.substring(i + 1, Math.min(j, json.length()));
    }

    // ------------------------------------------------------------- planification
    static PendingIntent pi(Context c) {
        Intent i = new Intent(c, Verificateur.class);
        i.setAction(ACTION);
        int drapeaux = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) drapeaux |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, 7, i, drapeaux);
    }

    /** (Re)programme le prochain réveil. Volontairement « inexact » : Android
        regroupe alors les réveils de plusieurs applications, ce qui économise
        nettement la batterie. */
    static void programmer(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long delai = Notifs.minutes(c) * 60L * 1000L;
        long quand = System.currentTimeMillis() + delai;
        try {
            am.cancel(pi(c));
            if (!Notifs.actif(c)) return;
            am.set(AlarmManager.RTC, quand, pi(c));
        } catch (Exception e) {
            Log.i("PilotRH", "planification impossible : " + e);
        }
    }

    /** Redémarrage du téléphone : sans cela, les notifications s'arrêtent
        silencieusement jusqu'à la prochaine ouverture de l'application. */
    public static class AuDemarrage extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent i) {
            programmer(c.getApplicationContext());
        }
    }
}
