package android.content;
import android.net.Uri;
public class Intent {
  public static final String ACTION_VIEW="android.intent.action.VIEW";
  public static final int FLAG_ACTIVITY_NEW_TASK=268435456, FLAG_ACTIVITY_CLEAR_TOP=67108864;
  public Intent(){} public Intent(String a, Uri u){}
  public Intent(Context c, Class<?> k){}
  public Intent(String action){}
  public String getAction(){return null;}
  public Uri getData(){return null;}
  public Intent setAction(String a){return this;}
  public Intent setFlags(int f){return this;}
  public Intent setData(Uri u){return this;}
  public Intent putExtra(String k,boolean v){return this;}
  public Intent putExtra(String k,String v){return this;}
  public boolean getBooleanExtra(String k,boolean def){return def;}
}
