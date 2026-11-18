package android.app;
import android.content.Context; import android.net.Uri;
public class Notification {
  public static final int PRIORITY_HIGH=1, PRIORITY_DEFAULT=0;
  public static class Builder {
    public Builder(Context c){} public Builder(Context c,String canal){}
    public Builder setSmallIcon(int i){return this;}
    public Builder setContentTitle(CharSequence s){return this;}
    public Builder setContentText(CharSequence s){return this;}
    public Builder setStyle(Object s){return this;}
    public Builder setAutoCancel(boolean b){return this;}
    public Builder setContentIntent(PendingIntent p){return this;}
    public Builder setNumber(int n){return this;}
    public Builder setPriority(int p){return this;}
    public Builder setSound(Uri u){return this;}
    public Builder setVibrate(long[] v){return this;}
    public Notification build(){return new Notification();}
  }
  public static class BigTextStyle { public BigTextStyle bigText(CharSequence s){return this;} }
}
