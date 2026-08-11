package android.net;
/* Doublure de test : contrairement aux autres stubs, celle-ci analyse réellement
   l'adresse, pour que la logique de normalisation soit vérifiable hors Android. */
public class Uri {
  private final String scheme, host; private final int port;
  private Uri(String s,String h,int p){scheme=s;host=h;port=p;}
  public static Uri parse(String s){
    try{ java.net.URI u=new java.net.URI(s);
      return new Uri(u.getScheme(), u.getHost(), u.getPort());
    }catch(Exception e){ return new Uri(null,null,-1); }
  }
  public String getHost(){return host;}
  public int getPort(){return port;}
  public String getScheme(){return scheme;}
  public String toString(){return scheme+"://"+host+(port>0?":"+port:"");}
}
