package android.webkit;
public class CookieManager {
  public static CookieManager getInstance(){return new CookieManager();}
  public void setAcceptCookie(boolean b){}
  public void removeAllCookies(ValueCallback<Boolean> cb){}
}
