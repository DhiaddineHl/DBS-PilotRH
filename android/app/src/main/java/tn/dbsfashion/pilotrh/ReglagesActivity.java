package tn.dbsfashion.pilotrh;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Réglages des notifications, en français et sans jargon.
 *
 * Chaque changement de son ou de vibration est **essayé immédiatement** (le
 * téléphone joue le son et vibre) : c'est le seul moyen pour une ouvrière de
 * choisir en connaissance de cause, sans aller fouiller dans les réglages
 * Android.
 */
public class ReglagesActivity extends Activity {

    private SharedPreferences p;
    private Spinner son, frequence, silenceDe, silenceA;
    private CheckBox actif, vibration;

    private static final int[] FREQUENCES = {15, 30, 60, 120, 240};

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        p = Notifs.prefs(this);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#faf8f3"));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int m = dp(22);
        col.setPadding(m, dp(28), m, dp(36));
        sv.addView(col);
        setContentView(sv);

        col.addView(titre(getString(R.string.reg_titre), 21, "#1a1d29", true));
        col.addView(titre(getString(R.string.reg_aide), 13, "#5c6270", false));

        actif = new CheckBox(this);
        actif.setText(R.string.reg_actif);
        actif.setChecked(Notifs.actif(this));
        actif.setTextSize(15);
        col.addView(actif, mt(dp(18)));

        col.addView(section(getString(R.string.reg_son)));
        son = liste(col, Notifs.SONS, Notifs.son(this));
        son.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> a, View v, int pos, long id) {
                essayerSon(pos);
            }
            @Override public void onNothingSelected(AdapterView<?> a) {}
        });

        vibration = new CheckBox(this);
        vibration.setText(R.string.reg_vibration);
        vibration.setChecked(Notifs.vibration(this));
        vibration.setTextSize(15);
        vibration.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { if (vibration.isChecked()) essayerVibration(); }
        });
        col.addView(vibration, mt(dp(14)));

        col.addView(section(getString(R.string.reg_frequence)));
        String[] freqLabels = new String[FREQUENCES.length];
        int posFreq = 1;
        for (int i = 0; i < FREQUENCES.length; i++) {
            freqLabels[i] = (FREQUENCES[i] < 60)
                    ? getString(R.string.reg_minutes, FREQUENCES[i])
                    : getString(R.string.reg_heures, FREQUENCES[i] / 60);
            if (FREQUENCES[i] == Notifs.minutes(this)) posFreq = i;
        }
        frequence = liste(col, freqLabels, posFreq);
        col.addView(titre(getString(R.string.reg_frequence_note), 12, "#6b7280", false));

        col.addView(section(getString(R.string.reg_silence)));
        col.addView(titre(getString(R.string.reg_silence_aide), 12.5f, "#5c6270", false));
        String[] heures = new String[25];
        heures[0] = getString(R.string.reg_sans);
        for (int h = 0; h < 24; h++) heures[h + 1] = String.format("%02d:00", h);
        LinearLayout ligne = new LinearLayout(this);
        ligne.setOrientation(LinearLayout.HORIZONTAL);
        col.addView(ligne, mt(dp(6)));
        LinearLayout g = new LinearLayout(this); g.setOrientation(LinearLayout.VERTICAL);
        LinearLayout d = new LinearLayout(this); d.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams moitie =
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        ligne.addView(g, moitie); ligne.addView(d, moitie);
        g.addView(titre(getString(R.string.reg_de), 12, "#5c6270", false));
        silenceDe = liste(g, heures, Notifs.silenceDe(this) < 0 ? 0 : Notifs.silenceDe(this) + 1);
        d.addView(titre(getString(R.string.reg_a), 12, "#5c6270", false));
        silenceA = liste(d, heures, Notifs.silenceA(this) < 0 ? 0 : Notifs.silenceA(this) + 1);

        Button ok = new Button(this);
        ok.setText(R.string.reg_enregistrer);
        ok.setAllCaps(false);
        col.addView(ok, mt(dp(26)));
        ok.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { enregistrer(); }
        });

        Button essai = new Button(this);
        essai.setText(R.string.reg_essai);
        essai.setAllCaps(false);
        col.addView(essai, mt(dp(10)));
        essai.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                enregistrer(false);
                Notifs.afficher(ReglagesActivity.this, 1, 0,
                        getString(R.string.reg_essai_titre), getString(R.string.reg_essai_texte), false);
                Toast.makeText(ReglagesActivity.this, R.string.reg_essai_envoye, Toast.LENGTH_LONG).show();
            }
        });

        Button systeme = new Button(this);
        systeme.setText(R.string.reg_systeme);
        systeme.setAllCaps(false);
        col.addView(systeme, mt(dp(10)));
        systeme.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { ouvrirReglagesSysteme(); }
        });
        col.addView(titre(getString(R.string.reg_systeme_note), 12, "#6b7280", false));
    }

    // ------------------------------------------------------------------ actions
    private void enregistrer() { enregistrer(true); }

    private void enregistrer(boolean fermer) {
        int de = silenceDe.getSelectedItemPosition() - 1;
        int a = silenceA.getSelectedItemPosition() - 1;
        p.edit()
         .putBoolean(Notifs.CLE_ACTIF, actif.isChecked())
         .putInt(Notifs.CLE_SON, son.getSelectedItemPosition())
         .putBoolean(Notifs.CLE_VIB, vibration.isChecked())
         .putInt(Notifs.CLE_MINUTES, FREQUENCES[frequence.getSelectedItemPosition()])
         .putInt(Notifs.CLE_SILENCE_DE, de)
         .putInt(Notifs.CLE_SILENCE_A, a)
         .apply();
        Notifs.preparerCanal(this);
        Verificateur.programmer(this);
        if (fermer) {
            Toast.makeText(this, R.string.reg_enregistre, Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    /** Fait entendre le son choisi, pour choisir en connaissance de cause. */
    private void essayerSon(int choix) {
        Uri u = Notifs.sonUri(choix);
        if (u == null) return;
        try {
            Ringtone r = RingtoneManager.getRingtone(getApplicationContext(), u);
            if (r != null) r.play();
        } catch (Exception e) { /* certains téléphones refusent : sans conséquence */ }
    }

    private void essayerVibration() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) {
                Toast.makeText(this, R.string.reg_pas_de_vibreur, Toast.LENGTH_LONG).show();
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(new long[]{0, 250, 150, 250}, -1));
            } else {
                @SuppressWarnings("deprecation")
                Vibrator vieux = v;
                vieux.vibrate(new long[]{0, 250, 150, 250}, -1);
            }
        } catch (Exception e) { /* sans conséquence */ }
    }

    /**
     * Depuis Android 8, le son d'un canal ne peut plus être changé par
     * l'application une fois le canal créé : seul l'utilisateur peut le faire
     * dans les réglages du système. On l'y emmène directement.
     */
    private void ouvrirReglagesSysteme() {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                        .putExtra(Settings.EXTRA_CHANNEL_ID, Notifs.canal(this));
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getPackageName()));
            }
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, R.string.reg_systeme_echec, Toast.LENGTH_LONG).show();
        }
    }

    // -------------------------------------------------------------- utilitaires
    private Spinner liste(LinearLayout parent, String[] valeurs, int position) {
        Spinner sp = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, valeurs);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(a);
        if (position >= 0 && position < valeurs.length) sp.setSelection(position);
        parent.addView(sp, mt(dp(4)));
        return sp;
    }

    private LinearLayout.LayoutParams mt(int haut) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = haut;
        return lp;
    }

    private TextView section(String texte) {
        TextView t = titre(texte, 12, "#8a6d3b", true);
        t.setPadding(0, dp(22), 0, 0);
        return t;
    }

    private TextView titre(String texte, float taille, String couleur, boolean gras) {
        TextView t = new TextView(this);
        t.setText(texte);
        t.setTextSize(taille);
        t.setTextColor(Color.parseColor(couleur));
        if (gras) t.setTypeface(t.getTypeface(), Typeface.BOLD);
        t.setPadding(0, dp(6), 0, 0);
        return t;
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }
}
