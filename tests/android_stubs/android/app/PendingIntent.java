package android.app;
import android.content.Context; import android.content.Intent;
public class PendingIntent {
  public static final int FLAG_UPDATE_CURRENT=134217728, FLAG_IMMUTABLE=67108864;
  public static PendingIntent getActivity(Context c,int r,Intent i,int f){return new PendingIntent();}
  public static PendingIntent getBroadcast(Context c,int r,Intent i,int f){return new PendingIntent();}
}
