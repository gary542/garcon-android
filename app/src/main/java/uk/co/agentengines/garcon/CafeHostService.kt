package uk.co.agentengines.garcon

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.concurrent.Executors

data class HostState(val starting:Boolean=false,val pin:String="",val error:String="")

class CafeHostService : Service() {
    private val lifecycle=Executors.newSingleThreadExecutor()
    private var listener:CafeListener?=null
    private var engine:CafeEngine?=null
    private var wake:PowerManager.WakeLock?=null

    override fun onCreate(){
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(
            "cafe-host","Café host",NotificationManager.IMPORTANCE_LOW))
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val open=PendingIntent.getActivity(this,1,Intent(this,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_IMMUTABLE)
        val notice=Notification.Builder(this,"cafe-host").setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentTitle("Garçon is hosting your café").setContentText("Staff on your café Wi-Fi can share orders.")
            .setContentIntent(open).setOngoing(true).build()
        startForeground(44,notice)
        if(state.value.pin.isEmpty() && !state.value.starting) {
            state.value=HostState(starting=true)
            lifecycle.execute {
                try {
                    val e=CafeEngine(applicationContext);engine=e
                    val l=CafeListener(applicationContext,e);listener=l
                    wake=getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Garcon:CafeHost").apply { acquire() }
                    current=e
                    state.value=HostState(pin=l.pin)
                } catch(_:Exception) { state.value=HostState(error="Could not start the café host. Close and reopen Garçon, then try again.");stopSelf() }
            }
        }
        return START_STICKY
    }
    override fun onDestroy(){
        current=null
        lifecycle.execute {
            runCatching { listener?.close() };runCatching { engine?.close() }
            wake?.takeIf { it.isHeld }?.release()
            if(state.value.error.isEmpty())state.value=HostState()
        }
        lifecycle.shutdown()
        super.onDestroy()
    }
    override fun onBind(intent:Intent?):IBinder?=null
    companion object {
        val state=MutableStateFlow(HostState())
        @Volatile var current:CafeEngine?=null
            private set
        fun start(c:Context){c.startForegroundService(Intent(c,CafeHostService::class.java))}
    }
}
