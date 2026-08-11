package tn.dbsfashion.pilotrh;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * PilotRH — espace salarié pour Android.
 *
 * Ce n'est volontairement PAS une seconde application : c'est une coquille
 * autour de l'espace salarié déjà servi par le serveur (/moi). Il n'existe donc
 * qu'un seul calcul des heures, celui du serveur, et une correction de paie
 * n'a jamais à être portée deux fois.
 *
 * Trois choses que l'application apporte par rapport au navigateur :
 *   1. Une icône sur l'écran d'accueil, sans passer par « Ajouter à l'écran
 *      d'accueil » que beaucoup d'ouvrières ne trouvent pas.
 *   2. Le scan de la carte QR ouvre directement l'application, qui mémorise le
 *      jeton : plus jamais besoin de rescanner la carte (voir l'intent-filter
 *      du manifeste).
 *   3. Un message clair quand le réseau de l'atelier tombe, au lieu de la page
 *      d'erreur du navigateur.
 *
 * Aucune bibliothèque externe n'est utilisée : le .apk pèse quelques dizaines de
 * kilo-octets et se compile avec le seul SDK Android.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "pilotrh";
    private static final String CLE_SERVEUR = "serveur";

    private WebView web;
    private FrameLayout racine;
    private String serveur = "";

    // ------------------------------------------------------------------ cycle
    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        racine = new FrameLayout(this);
        racine.setBackgroundColor(Color.parseColor("#faf8f3"));
        setContentView(racine);

        serveur = prefs().getString(CLE_SERVEUR, "");

        // Un scan de carte QR arrive ici : l'adresse du serveur s'en déduit.
        Uri lien = lienEntrant(getIntent());
        if (lien != null) {
            serveur = origine(lien);
            prefs().edit().putString(CLE_SERVEUR, serveur).apply();
        }

        if (serveur.isEmpty()) {
            ecranReglage(null);
        } else {
            ecranWeb(lien != null ? lien.toString() : serveur + "/moi");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri lien = lienEntrant(intent);
        if (lien == null) return;
        serveur = origine(lien);
        prefs().edit().putString(CLE_SERVEUR, serveur).apply();
        if (web == null) ecranWeb(lien.toString());
        else web.loadUrl(lien.toString());
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ----------------------------------------------------- premier démarrage
    /**
     * Écran affiché une seule fois : l'adresse du serveur PilotRH. Elle est
     * demandée plutôt que codée en dur parce qu'elle change selon l'installation
     * (nom de domaine hébergé, ou adresse locale de l'ordinateur de l'atelier).
     */
    private void ecranReglage(String messageErreur) {
        racine.removeAllViews();
        web = null;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int m = dp(22);
        col.setPadding(m, dp(48), m, m);

        col.addView(titre(getString(R.string.reglage_titre), 21, "#1a1d29", true));
        col.addView(titre(getString(R.string.reglage_aide), 13.5f, "#5c6270", false));

        final EditText champ = new EditText(this);
        champ.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        champ.setHint(R.string.reglage_exemple);
        champ.setSingleLine(true);
        champ.setText(serveur);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(20);
        col.addView(champ, lp);

        final TextView erreur = titre(messageErreur == null ? "" : messageErreur, 13, "#a4331f", false);
        erreur.setVisibility(messageErreur == null ? View.GONE : View.VISIBLE);
        col.addView(erreur);

        Button ok = new Button(this);
        ok.setText(R.string.reglage_valider);
        ok.setAllCaps(false);
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp2.topMargin = dp(18);
        col.addView(ok, lp2);

        col.addView(titre(getString(R.string.reglage_note), 12.5f, "#6b7280", false));

        ok.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String saisi = normaliser(champ.getText().toString());
                if (saisi == null) {
                    erreur.setText(R.string.reglage_invalide);
                    erreur.setVisibility(View.VISIBLE);
                    return;
                }
                serveur = saisi;
                prefs().edit().putString(CLE_SERVEUR, serveur).apply();
                ecranWeb(serveur + "/moi");
            }
        });

        racine.addView(col);
    }

    /** Complète et vérifie l'adresse saisie ; renvoie null si elle est inutilisable. */
    static String normaliser(String saisi) {
        if (saisi == null) return null;
        String s = saisi.trim().replace(" ", "");
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            // une adresse locale reste en http, un nom de domaine passe en https
            boolean locale = s.startsWith("192.168.") || s.startsWith("10.")
                    || s.startsWith("172.") || s.startsWith("localhost");
            s = (locale ? "http://" : "https://") + s;
        }
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        // on ne garde que le schéma + l'hôte (+ le port) : le chemin est ajouté ensuite
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        return u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }

    private static String origine(Uri u) {
        return u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }

    private static Uri lienEntrant(Intent i) {
        if (i == null || !Intent.ACTION_VIEW.equals(i.getAction())) return null;
        Uri u = i.getData();
        if (u == null || u.getHost() == null) return null;
        return u;
    }

    // --------------------------------------------------------------- webview
    private void ecranWeb(String url) {
        racine.removeAllViews();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // Indispensable : le jeton personnel de la salariée est conservé dans le
        // stockage local de la page. Sans cette ligne, il faudrait rescanner la
        // carte QR à chaque ouverture.
        s.setDomStorageEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return horsServeur(r.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return horsServeur(Uri.parse(url));
            }

            /* Deux variantes à écrire : sur Android 6 et plus c'est la version
               « WebResourceRequest » qui est appelée, l'ancienne ne l'est plus.
               N'en écrire qu'une laissait l'écran blanc au lieu du message. */
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r != null && r.isForMainFrame()) ecranErreur();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView v, int code, String desc, String url) {
                // seule l'erreur de la page principale mérite un écran dédié
                if (url != null && serveur != null && url.startsWith(serveur)) ecranErreur();
            }
        });

        racine.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ajouterBoutonMenu();

        if (!reseauDisponible()) { ecranErreur(); return; }
        web.loadUrl(url);
    }

    /** Un lien vers un autre site s'ouvre dans le navigateur, pas dans l'application. */
    private boolean horsServeur(Uri u) {
        if (u == null) return false;
        String o = origine(u);
        if (o.equalsIgnoreCase(serveur)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception e) {
            Toast.makeText(this, R.string.aucun_navigateur, Toast.LENGTH_LONG).show();
        }
        return true;
    }

    // ----------------------------------------------------------- hors réseau
    private boolean reseauDisponible() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo n = cm.getActiveNetworkInfo();
            return n != null && n.isConnected();
        } catch (Exception e) {
            return true;   // en cas de doute on laisse tenter le chargement
        }
    }

    /**
     * Écran d'erreur en français, avec un bouton pour réessayer. Le message
     * distingue les deux causes réelles : le téléphone n'a pas de réseau, ou le
     * serveur n'est pas joignable (mauvaise adresse, serveur arrêté).
     */
    private void ecranErreur() {
        racine.removeAllViews();
        web = null;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_VERTICAL);
        int m = dp(24);
        col.setPadding(m, m, m, m);

        boolean reseau = reseauDisponible();
        col.addView(titre(getString(reseau ? R.string.err_serveur_titre : R.string.err_reseau_titre),
                19, "#1a1d29", true));
        col.addView(titre(getString(reseau ? R.string.err_serveur_aide : R.string.err_reseau_aide),
                13.5f, "#5c6270", false));
        col.addView(titre(serveur, 12.5f, "#6b7280", false));

        Button retry = new Button(this);
        retry.setText(R.string.reessayer);
        retry.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(18);
        col.addView(retry, lp);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { ecranWeb(serveur + "/moi"); }
        });

        Button chg = new Button(this);
        chg.setText(R.string.changer_adresse);
        chg.setAllCaps(false);
        col.addView(chg, lp);
        chg.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { ecranReglage(null); }
        });

        racine.addView(col);
    }

    // ---------------------------------------------------------------- menu ⋯
    /**
     * Petit bouton discret en bas à gauche : l'application n'a pas de barre de
     * titre (pour ressembler à une vraie application et laisser toute la place au
     * contenu), il faut donc un point d'entrée visible vers les réglages.
     */
    private void ajouterBoutonMenu() {
        Button b = new Button(this);
        b.setText("⋯");
        b.setTextColor(Color.parseColor("#5c6270"));
        b.setBackgroundColor(Color.parseColor("#22000000"));
        b.setContentDescription(getString(R.string.menu));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(44), dp(36));
        lp.gravity = Gravity.BOTTOM | Gravity.START;
        lp.leftMargin = dp(6);
        lp.bottomMargin = dp(6);
        b.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { ouvrirMenu(); }
        });
        racine.addView(b, lp);
    }

    private void ouvrirMenu() {
        final String[] choix = {
                getString(R.string.m_rafraichir),
                getString(R.string.m_adresse),
                getString(R.string.m_rh),
                getString(R.string.m_oublier),
        };
        new AlertDialog.Builder(this)
                .setTitle(R.string.app_name)
                .setItems(choix, (dialog, quel) -> {
                    switch (quel) {
                        case 0:
                            if (web != null) web.reload();
                            break;
                        case 1:
                            ecranReglage(null);
                            break;
                        case 2:
                            try {
                                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(serveur + "/login")));
                            } catch (Exception e) {
                                Toast.makeText(this, R.string.aucun_navigateur, Toast.LENGTH_LONG).show();
                            }
                            break;
                        default:
                            confirmerOubli();
                    }
                })
                .setNegativeButton(R.string.fermer, null)
                .show();
    }

    /**
     * Efface le stockage local de la WebView, donc le jeton personnel : utile
     * quand un téléphone change de main. La confirmation est explicite parce
     * qu'il faudra rescanner la carte QR ensuite.
     */
    private void confirmerOubli() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.m_oublier)
                .setMessage(R.string.oublier_confirme)
                .setNegativeButton(R.string.annuler, null)
                .setPositiveButton(R.string.effacer, (d, w) -> {
                    if (web != null) {
                        web.clearCache(true);
                        web.clearHistory();
                        web.evaluateJavascript("try{localStorage.clear()}catch(e){}", null);
                    }
                    CookieManager.getInstance().removeAllCookies(null);
                    Toast.makeText(this, R.string.oublie, Toast.LENGTH_LONG).show();
                    if (web != null) web.loadUrl(serveur + "/moi");
                })
                .show();
    }

    // ------------------------------------------------------------- utilitaires
    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    private TextView titre(String texte, float taille, String couleur, boolean gras) {
        TextView t = new TextView(this);
        t.setText(texte);
        t.setTextSize(taille);
        t.setTextColor(Color.parseColor(couleur));
        if (gras) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, dp(6), 0, 0);
        return t;
    }
}
