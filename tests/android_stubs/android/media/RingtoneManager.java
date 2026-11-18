package android.media;
import android.content.Context; import android.net.Uri;
public class RingtoneManager {
  public static final int TYPE_NOTIFICATION=2, TYPE_RINGTONE=1, TYPE_ALARM=4;
  public static Uri getDefaultUri(int type){return Uri.parse("content://settings/notification");}
  public static Ringtone getRingtone(Context c, Uri u){return new Ringtone();}
}
