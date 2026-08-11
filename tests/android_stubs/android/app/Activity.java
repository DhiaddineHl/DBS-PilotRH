package android.app;
import android.content.Context; import android.content.Intent;
import android.os.Bundle; import android.view.View;
public class Activity extends Context {
  protected void onCreate(Bundle b){}
  protected void onNewIntent(Intent i){}
  public void onBackPressed(){}
  public void setContentView(View v){}
  public Intent getIntent(){return null;}
}
