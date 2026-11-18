package android.app;
public class NotificationManager {
  public static final int IMPORTANCE_HIGH=4;
  public NotificationChannel getNotificationChannel(String id){return null;}
  public java.util.List<NotificationChannel> getNotificationChannels(){return new java.util.ArrayList<>();}
  public void createNotificationChannel(NotificationChannel c){}
  public void deleteNotificationChannel(String id){}
  public void notify(int id, Notification n){}
  public void cancel(int id){}
}
