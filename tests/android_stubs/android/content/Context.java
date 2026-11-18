package android.content;
import android.content.res.Resources;
public class Context {
  public static final int MODE_PRIVATE=0;
  public static final String CONNECTIVITY_SERVICE="connectivity";
  public static final String NOTIFICATION_SERVICE="notification";
  public static final String ALARM_SERVICE="alarm";
  public static final String VIBRATOR_SERVICE="vibrator";
  public SharedPreferences getSharedPreferences(String n,int m){return null;}
  public Object getSystemService(String n){return null;}
  public void startActivity(Intent i){}
  public String getString(int id){return "";}
  public String getString(int id,Object... a){return "";}
  public String getPackageName(){return "tn.dbsfashion.pilotrh";}
  public Context getApplicationContext(){return this;}
  public Resources getResources(){return null;}
}
