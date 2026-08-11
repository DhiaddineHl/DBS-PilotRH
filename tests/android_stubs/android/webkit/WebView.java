package android.webkit;
import android.content.Context; import android.view.ViewGroup;
public class WebView extends ViewGroup {
  public WebView(Context c){super(c);}
  public WebSettings getSettings(){return new WebSettings();}
  public void setWebViewClient(WebViewClient c){}
  public void loadUrl(String u){}
  public boolean canGoBack(){return false;} public void goBack(){}
  public void reload(){} public void clearCache(boolean b){} public void clearHistory(){}
  public void evaluateJavascript(String js, ValueCallback<String> cb){}
}
