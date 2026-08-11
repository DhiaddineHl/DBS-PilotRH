package android.app;
import android.content.Context; import android.content.DialogInterface;
public class AlertDialog {
  public static class Builder {
    public Builder(Context c){}
    public Builder setTitle(int r){return this;}
    public Builder setMessage(int r){return this;}
    public Builder setItems(CharSequence[] items, DialogInterface.OnClickListener l){return this;}
    public Builder setNegativeButton(int r, DialogInterface.OnClickListener l){return this;}
    public Builder setPositiveButton(int r, DialogInterface.OnClickListener l){return this;}
    public AlertDialog show(){return null;}
  }
}
