package tn.dbsfashion.pilotrh;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/**
 * Notifications de l'application salariée.
 *
 * Un point qu'il faut connaître, parce qu'il dicte toute la conception : depuis
 * Android 8, le son et la vibration appartiennent au CANAL de notification, et
 * un canal déjà créé ne peut plus être modifié par l'application — seul
 * l'utilisateur peut le changer dans les réglages du système. Changer de son
 * revient donc à créer un NOUVEAU canal.
 *
 * On fabrique donc un identifiant de canal à partir des réglages choisis
 * (« messages_son2_vib1 ») : chaque combinaison a son canal, et changer de son
 * dans l'application bascule simplement sur un autre canal. Les canaux devenus
 * inutiles sont supprimés pour ne pas encombrer les réglages du téléphone.
 */
public final class Notifs {

    static final String PREFS = "pilotrh";
    static final String CLE_ACTIF = "notif_actif";
    static final String CLE_SON = "notif_son";          // 0 silencieux · 1 défaut · 2 sonnerie · 3 alarme
    static final String CLE_VIB = "notif_vibration";
    static final String CLE_MINUTES = "notif_minutes";  // fréquence de vérification
    static final String CLE_SILENCE_DE = "notif_silence_de";   // heure (0-23), -1 = pas de plage
    static final String CLE_SILENCE_A = "notif_silence_a";

    static final String[] SONS = {"Silencieux", "Son par défaut", "Sonnerie", "Alarme"};

    private Notifs() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean actif(Context c)   { return prefs(c).getBoolean(CLE_ACTIF, true); }
    static int son(Context c)         { return prefs(c).getInt(CLE_SON, 1); }
    static boolean vibration(Context c) { return prefs(c).getBoolean(CLE_VIB, true); }
    static int minutes(Context c)     { return Math.max(15, prefs(c).getInt(CLE_MINUTES, 30)); }
    static int silenceDe(Context c)   { return prefs(c).getInt(CLE_SILENCE_DE, -1); }
    static int silenceA(Context c)    { return prefs(c).getInt(CLE_SILENCE_A, -1); }

    /** Identifiant de canal déduit des réglages : changer de son change de canal. */
    static String canal(Context c) {
        return "messages_son" + son(c) + "_vib" + (vibration(c) ? 1 : 0);
    }

    static Uri sonUri(int choix) {
        switch (choix) {
            case 0:  return null;                                                    // silencieux
            case 2:  return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            case 3:  return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            default: return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
    }

    /**
     * Crée le canal correspondant aux réglages actuels et retire les autres, pour
     * que la liste des notifications du téléphone reste lisible.
     */
    static void preparerCanal(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        String actuel = canal(c);
        for (NotificationChannel ancien : nm.getNotificationChannels()) {
            if (ancien.getId().startsWith("messages_") && !ancien.getId().equals(actuel)) {
                nm.deleteNotificationChannel(ancien.getId());
            }
        }
        if (nm.getNotificationChannel(actuel) != null) return;

        NotificationChannel ch = new NotificationChannel(actuel,
                c.getString(R.string.canal_messages),
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(c.getString(R.string.canal_messages_desc));
        ch.enableVibration(vibration(c));
        if (vibration(c)) ch.setVibrationPattern(new long[]{0, 250, 150, 250});
        Uri u = sonUri(son(c));
        if (u == null) {
            ch.setSound(null, null);
        } else {
            ch.setSound(u, new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build());
        }
        nm.createNotificationChannel(ch);
    }

    /** Vrai si l'heure actuelle tombe dans la plage de silence choisie. */
    static boolean enSilence(Context c, int heure) {
        int de = silenceDe(c), a = silenceA(c);
        if (de < 0 || a < 0 || de == a) return false;
        // la plage peut passer minuit (22 h → 6 h)
        return (de < a) ? (heure >= de && heure < a) : (heure >= de || heure < a);
    }

    /**
     * Affiche la notification. Le texte reste volontairement court : le contenu
     * complet du message n'apparaît pas sur l'écran verrouillé d'un téléphone
     * qui peut être posé sur une table d'atelier.
     */
    static void afficher(Context c, int messages, int sondages, String titre, String apercu,
                         boolean important) {
        if (!actif(c)) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        preparerCanal(c);

        Intent i = new Intent(c, MainActivity.class);
        i.putExtra(MainActivity.EXTRA_MESSAGES, true);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int drapeaux = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) drapeaux |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(c, 1, i, drapeaux);

        String gros = (titre == null || titre.isEmpty())
                ? c.getString(R.string.notif_titre)
                : titre;
        String petit;
        if (messages > 1) petit = c.getString(R.string.notif_plusieurs, messages);
        else if (messages == 1) petit = (apercu == null || apercu.isEmpty())
                ? c.getString(R.string.notif_un) : apercu;
        else petit = c.getString(R.string.notif_sondage, sondages);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(c, canal(c))
                : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.stat_notify_chat)
         .setContentTitle(gros)
         .setContentText(petit)
         .setStyle(new Notification.BigTextStyle().bigText(petit))
         .setAutoCancel(true)
         .setContentIntent(pi);
        if (messages + sondages > 1) b.setNumber(messages + sondages);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // avant Android 8, son et vibration se règlent sur la notification
            @SuppressWarnings("deprecation")
            Notification.Builder vieux = b.setPriority(important
                    ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
            Uri u = sonUri(son(c));
            if (u != null) vieux.setSound(u);
            if (vibration(c)) vieux.setVibrate(new long[]{0, 250, 150, 250});
        }
        nm.notify(42, b.build());
    }

    static void effacer(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(42);
    }
}
