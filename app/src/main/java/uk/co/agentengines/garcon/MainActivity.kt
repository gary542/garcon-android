package uk.co.agentengines.garcon

import android.Manifest
import android.content.*
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private val gold=Color(0xffffc043)
private val surface=Color(0xff191c20)
private val dark=Color(0xff101214)

class MainActivity:ComponentActivity(){
    private val appPrefs by lazy { getSharedPreferences("connection",MODE_PRIVATE) }
    private var photo:ValueCallback<Array<Uri>>?=null
    private val selectPhoto=registerForActivityResult(ActivityResultContracts.GetContent()){uri->
        photo?.onReceiveValue(uri?.let { arrayOf(it) });photo=null
    }
    private val notification=registerForActivityResult(ActivityResultContracts.RequestPermission()){}
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme=darkColorScheme(primary=gold,onPrimary=dark,background=dark,surface=surface)) {
                Box(Modifier.fillMaxSize().background(dark).systemBarsPadding().imePadding()){ App() }
            }
        }
    }
    @Composable private fun App(){
        val host by CafeHostService.state.collectAsState()
        val scope=rememberCoroutineScope()
        var mode by remember {mutableStateOf(appPrefs.getString("mode","").orEmpty())}
        var remote by remember {mutableStateOf(runCatching { CafeAddress.parse(appPrefs.getString("invite","").orEmpty()) }.getOrNull())}
        var service by rememberSaveable {mutableStateOf(mode=="join" && remote!=null)}
        var opening by rememberSaveable {mutableStateOf(mode=="host")}
        var joining by rememberSaveable {mutableStateOf(false)}
        var text by rememberSaveable {mutableStateOf("")}
        var error by remember {mutableStateOf("")}
        var checking by remember {mutableStateOf(false)}
        var stopConfirm by remember {mutableStateOf(false)}
        var address by remember {mutableStateOf(localIp(this))}
        LaunchedEffect(host.pin,service){
            while(!service && host.pin.isNotEmpty()){address=localIp(this@MainActivity);kotlinx.coroutines.delay(3000)}
        }
        LaunchedEffect(Unit){ if(mode=="host" && host.pin.isEmpty()) CafeHostService.start(this@MainActivity) }
        LaunchedEffect(host,opening){if(opening && host.pin.isNotEmpty()){mode="host";service=true;opening=false}}
        fun saveMode(value:String,invite:String?=null){
            mode=value
            appPrefs.edit().putString("mode",value).apply { if(invite!=null) putString("invite",invite) }.apply()
        }
        BackHandler(service || joining){ if(service)service=false else joining=false }
        if(service && (mode!="host" || host.pin.isNotEmpty())){
            Column(Modifier.fillMaxSize()){
                Row(Modifier.fillMaxWidth().background(surface).padding(horizontal=14.dp),
                    verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                    Text(if(mode=="host") "Café host" else "Team phone",color=gold, fontSize=13.sp)
                    TextButton(onClick={service=false}){Text("Connection")}
                }
                key(mode,remote?.pin){
                    AndroidView(factory={Workstation(it,Station(applicationContext,if(mode=="host")null else remote)){cb->
                        photo?.onReceiveValue(null);photo=cb;selectPhoto.launch("image/*")
                    }},modifier=Modifier.fillMaxSize(),onRelease={it.destroy()})
                }
            }
            return
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement=Arrangement.spacedBy(16.dp)){
            Spacer(Modifier.height(12.dp))
            Image(painterResource(R.drawable.garcon_icon),null,Modifier.size(76.dp))
            Text("Garçon",fontSize=42.sp,color=Color.White,fontWeight=FontWeight.Bold)
            Text("By AgentEngines",color=gold)
            HorizontalDivider()
            if(host.pin.isNotEmpty()){
                Text("Your café is open on this phone",style=MaterialTheme.typography.headlineSmall,color=Color.White)
                Text("Keep this phone on the café Wi-Fi during service. Other staff can join with the invite and your team login.",color=Color.LightGray)
                Button(onClick={saveMode("host");service=true}){Text("Open café")}
                val ip=address
                if(ip!=null){
                    val code=CafeAddress(ip,host.pin).invite()
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedButton(onClick={
                            getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Garçon café invite",code))
                            error="Invite copied."
                        }){Text("Copy invite")}
                        OutlinedButton(onClick={
                            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,code),"Share café invite"))
                        }){Text("Share invite")}
                    }
                } else Text("Connect to the café Wi-Fi to share an invite. You can use the host on its own.",color=gold)
                TextButton(onClick={stopConfirm=true}){Text("Stop hosting")}
            } else if(joining){
                Text("Join the café",style=MaterialTheme.typography.headlineSmall,color=Color.White)
                Text("Connect to the host phone’s Wi-Fi network, then paste the invite shared by the owner.",color=Color.LightGray)
                OutlinedTextField(text,{text=it},Modifier.fillMaxWidth(),label={Text("Café invite")},maxLines=4)
                Button(enabled=!checking && text.isNotBlank(),onClick={
                    scope.launch {
                        checking=true;error=""
                        try {
                            val target=CafeAddress.parse(text)
                            val answer=withContext(Dispatchers.IO){JSONObject(CafeLink(target,context=applicationContext).request("""{"path":"info"}"""))}
                            require(answer.optInt("status")==200)
                            remote=target;saveMode("join",target.invite());service=true;joining=false
                        } catch(_:Exception){error="Could not join. Check the invite, Wi-Fi and that the host is running."}
                        finally {checking=false}
                    }
                }){Text(if(checking)"Connecting…" else "Join café")}
                TextButton(onClick={joining=false;error=""}){Text("Back")}
            } else {
                Text("Connect your team",style=MaterialTheme.typography.headlineMedium,color=Color.White)
                if(mode=="join" && remote!=null) Button(onClick={service=true}){Text("Open saved café")}
                Text("Use one phone as the café host. Orders entered on the floor appear in the kitchen, then at the till.",color=Color.LightGray)
                Button(modifier=Modifier.fillMaxWidth(),enabled=!host.starting,onClick={
                    error="";saveMode("host");opening=true
                    CafeHostService.start(this@MainActivity)
                    if(Build.VERSION.SDK_INT>=33)notification.launch(Manifest.permission.POST_NOTIFICATIONS)
                }){Text(if(host.starting)"Starting host…" else "Host café on this phone")}
                OutlinedButton(modifier=Modifier.fillMaxWidth(),enabled=!host.starting,onClick={joining=true;error=""}){Text("Join from a team phone")}
            }
            if(error.isNotEmpty() || host.error.isNotEmpty()) Text(error.ifBlank{host.error},color=gold)
        }
        if(stopConfirm) AlertDialog(onDismissRequest={stopConfirm=false},title={Text("Stop café hosting?")},
            text={Text("Staff phones will disconnect. Orders already received will be here when you start hosting again.")},
            confirmButton={TextButton(onClick={opening=false;service=false;saveMode("");stopService(Intent(this@MainActivity,CafeHostService::class.java));stopConfirm=false}){Text("Stop hosting")}},
            dismissButton={TextButton(onClick={stopConfirm=false}){Text("Keep hosting")}})
    }
}
