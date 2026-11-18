package android.os;
public class Vibrator {
  public boolean hasVibrator(){return true;}
  public void vibrate(long[] motif,int repeat){}
  public void vibrate(VibrationEffect e){}
}
