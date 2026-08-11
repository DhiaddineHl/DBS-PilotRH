package android.webkit;
public class WebViewClient {
  public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){return false;}
  public boolean shouldOverrideUrlLoading(WebView v, String url){return false;}
  public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e){}
  public void onReceivedError(WebView v,int code,String desc,String url){}
}
