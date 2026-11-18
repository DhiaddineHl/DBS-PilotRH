package android.widget;
import android.content.Context; import android.view.ViewGroup;
public class LinearLayout extends ViewGroup {
  public static final int VERTICAL=1, HORIZONTAL=0;
  public LinearLayout(Context c){super(c);}
  public void setOrientation(int o){}
  public void setGravity(int g){}
  public static class LayoutParams extends ViewGroup.LayoutParams {
    public int topMargin;
    public LayoutParams(int w,int h){super(w,h);}
    public LayoutParams(int w,int h,float poids){super(w,h);}
  }
}
