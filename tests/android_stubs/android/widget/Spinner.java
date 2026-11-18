package android.widget;
import android.content.Context;
public class Spinner extends AdapterView<Object> {
  public Spinner(Context c){super(c);}
  public void setAdapter(ArrayAdapter<?> a){}
  public void setSelection(int p){}
  public int getSelectedItemPosition(){return 0;}
  public void setOnItemSelectedListener(OnItemSelectedListener l){}
}
