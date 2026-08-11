package android.view;
import android.content.Context; import android.graphics.Typeface;
public class View {
  public static final int GONE=8, VISIBLE=0;
  public View(Context c){}
  public interface OnClickListener { void onClick(View v); }
  public void setOnClickListener(OnClickListener l){}
  public void setBackgroundColor(int c){}
  public void setPadding(int a,int b,int c,int d){}
  public void setVisibility(int v){}
  public void setContentDescription(CharSequence s){}
  public Typeface getTypeface(){return null;}
  public void setTypeface(Typeface t,int style){}
}
