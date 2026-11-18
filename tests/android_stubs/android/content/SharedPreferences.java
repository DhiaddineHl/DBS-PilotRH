package android.content;
public interface SharedPreferences {
  String getString(String k, String def);
  boolean getBoolean(String k, boolean def);
  int getInt(String k, int def);
  Editor edit();
  interface Editor {
    Editor putString(String k,String v);
    Editor putBoolean(String k,boolean v);
    Editor putInt(String k,int v);
    void apply();
  }
}
