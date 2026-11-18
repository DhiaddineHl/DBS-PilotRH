package android.app;
import android.net.Uri; import android.media.AudioAttributes;
public class NotificationChannel {
  public NotificationChannel(String id, CharSequence nom, int importance){}
  public String getId(){return "";}
  public void setDescription(String d){}
  public void enableVibration(boolean b){}
  public void setVibrationPattern(long[] p){}
  public void setSound(Uri u, AudioAttributes a){}
}
