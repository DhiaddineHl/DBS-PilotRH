package android.widget;
import android.content.Context; import android.view.View; import android.view.ViewGroup;
public abstract class AdapterView<T> extends ViewGroup {
  public AdapterView(Context c){super(c);}
  public interface OnItemSelectedListener {
    void onItemSelected(AdapterView<?> parent, View v, int position, long id);
    void onNothingSelected(AdapterView<?> parent);
  }
}
