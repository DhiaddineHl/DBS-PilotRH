package android.media;
public class AudioAttributes {
  public static final int CONTENT_TYPE_SONIFICATION=4, USAGE_NOTIFICATION=5;
  public static class Builder {
    public Builder setContentType(int t){return this;}
    public Builder setUsage(int u){return this;}
    public AudioAttributes build(){return new AudioAttributes();}
  }
}
