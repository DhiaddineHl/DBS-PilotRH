package android.widget;
import android.content.Context; import android.view.View;
public class TextView extends View {
  public TextView(Context c){super(c);}
  public void setText(CharSequence s){} public void setText(int r){}
  public void setTextSize(float s){} public void setTextColor(int c){}
  public void setSingleLine(boolean b){} public void setAllCaps(boolean b){}
  public void setHint(int r){}
  public CharSequence getText(){return "";}
}
