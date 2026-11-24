package uk.co.agentengines.garcon

import android.content.Context
import android.net.ConnectivityManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.*
import java.math.BigInteger
import java.net.*
import java.security.*
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.*
import java.util.concurrent.*
import javax.net.ssl.*
import javax.security.auth.x500.X500Principal

const val CAFE_PORT = 46473
private const val MAX_REQUEST = 800_000
private const val MAX_RESPONSE = 12_000_000
fun failure(message:String,code:Int=503) = JSONObject().put("status",code).put("data",JSONObject().put("error",message)).toString()
data class CafeAddress(val ip:String,val pin:String) {
    fun invite() = "GARCON1/$ip/$pin"
    companion object {
        fun parse(text:String):CafeAddress {
            val p=text.trim().split('/')
            require(p.size==3 && p[0]=="GARCON1" && p[2].matches(Regex("[a-fA-F0-9]{64}"))) { "Paste a complete Garçon café invite." }
            val octets=p[1].split('.')
            require(octets.size==4 && octets.all { it.matches(Regex("[0-9]{1,3}")) && it.toInt() in 0..255 }) { "Invalid café network address." }
            return CafeAddress(octets.joinToString("."){it.toInt().toString()},p[2].lowercase(Locale.ROOT))
        }
    }
}
@Suppress("DEPRECATION")
fun cafeWifi(context:Context):android.net.Network? {
    val cm=context.getSystemService(ConnectivityManager::class.java)
    return cm.allNetworks.firstOrNull { network ->
        cm.getNetworkCapabilities(network)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)==true
    }
}
fun localIp(context:Context):String? {
    val cm=context.getSystemService(ConnectivityManager::class.java)
    val network=cafeWifi(context) ?: return null
    return cm.getLinkProperties(network)?.linkAddresses.orEmpty().map { it.address }
        .filterIsInstance<Inet4Address>().firstOrNull { it.isSiteLocalAddress }?.hostAddress
}
private fun fp(c:X509Certificate)=MessageDigest.getInstance("SHA-256").digest(c.encoded).hex()
private fun writeFrame(out:OutputStream,value:String,max:Int) {
    val bytes=value.toByteArray(Charsets.UTF_8)
    require(bytes.size in 1..max)
    DataOutputStream(out).apply { writeInt(bytes.size);write(bytes);flush() }
}
private fun readFrame(input:InputStream,max:Int):String {
    val stream=DataInputStream(input)
    val size=stream.readInt()
    require(size in 1..max)
    return ByteArray(size).also(stream::readFully).toString(Charsets.UTF_8)
}
private const val ALIAS="garcon-wifi-identity-v1"
private fun identity():Pair<SSLContext,String> {
    val ks=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if(!ks.containsAlias(ALIAS)) {
        val start=Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR,-1) }
        val end=Calendar.getInstance().apply { add(Calendar.YEAR,15) }
        val gen=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore")
        gen.initialize(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)
            .setCertificateSubject(X500Principal("CN=Garcon Cafe"))
            .setCertificateSerialNumber(BigInteger(96,SecureRandom()).add(BigInteger.ONE))
            .setCertificateNotBefore(start.time).setCertificateNotAfter(end.time).build())
        gen.generateKeyPair()
    }
    val cert=ks.getCertificate(ALIAS) as X509Certificate
    val key=ks.getKey(ALIAS,null) as PrivateKey
    val manager=object:X509KeyManager {
        override fun chooseServerAlias(t:String?, issuers:Array<out Principal>?,socket:Socket?) = if(t=="EC") ALIAS else null
        override fun getServerAliases(t:String?,issuers:Array<out Principal>?)=if(t=="EC") arrayOf(ALIAS) else null
        override fun getPrivateKey(alias:String?)=if(alias==ALIAS) key else null
        override fun getCertificateChain(alias:String?)=if(alias==ALIAS) arrayOf(cert) else null
        override fun getClientAliases(t:String?,issuers:Array<out Principal>?):Array<String>?=null
        override fun chooseClientAlias(t:Array<out String>?,issuers:Array<out Principal>?,socket:Socket?):String?=null
    }
    return SSLContext.getInstance("TLS").apply { init(arrayOf(manager),null,null) } to fp(cert)
}

class CafeListener(context:Context,private val engine:CafeEngine,port:Int=CAFE_PORT) : Closeable {
    private val identity=identity()
    val pin = identity.second
    private val socket=(identity.first.serverSocketFactory.createServerSocket() as SSLServerSocket).apply {
        enabledProtocols=supportedProtocols.filter { it=="TLSv1.2" || it=="TLSv1.3" }.toTypedArray()
        reuseAddress=true;bind(InetSocketAddress(port),24)
    }
    val port=socket.localPort
    private val peers=ThreadPoolExecutor(4,8,30,TimeUnit.SECONDS,ArrayBlockingQueue(16))
    private val active=ConcurrentHashMap.newKeySet<Socket>()
    private val acceptor=Thread({
        while(!socket.isClosed) try {
            val client=socket.accept() as SSLSocket
            val peer=client.inetAddress
            if(!peer.isSiteLocalAddress && !peer.isLinkLocalAddress && !peer.isLoopbackAddress) {client.close(); continue}
            active.add(client)
            try { peers.execute { try { client.use {
                it.soTimeout=9000;it.startHandshake()
                val request=readFrame(it.inputStream,MAX_REQUEST)
                val response=engine.request(request,it.inetAddress.hostAddress?:"peer",false)
                writeFrame(it.outputStream,response,MAX_RESPONSE)
            } } catch(_:Exception) {} finally { active.remove(client) } } }
            catch(_:RejectedExecutionException){active.remove(client);client.close()}
        } catch(_:SocketException){ if(socket.isClosed) break }
    },"cafe-wifi-listener").apply {start()}
    override fun close(){socket.close();active.forEach { runCatching { it.close() } };peers.shutdown();acceptor.join(1000);peers.awaitTermination(3,TimeUnit.SECONDS)}
}

class CafeLink(private val address:CafeAddress,private val port:Int=CAFE_PORT,private val context:Context?=null) {
    private val tls=SSLContext.getInstance("TLS").apply {
        init(null,arrayOf(object:X509TrustManager {
            override fun getAcceptedIssuers()=emptyArray<X509Certificate>()
            override fun checkClientTrusted(c:Array<X509Certificate>,auth:String){throw CertificateException()}
            override fun checkServerTrusted(c:Array<X509Certificate>,auth:String){
                val cert=c.firstOrNull() ?: throw CertificateException()
                if(fp(cert)!=address.pin)throw CertificateException("Café identity changed")
                cert.checkValidity()
            }
        }),null)
    }
    fun request(request:String):String {
        val raw=if(context==null) Socket() else {
            val network=cafeWifi(context) ?: throw IOException("Café Wi-Fi is disconnected")
            network.socketFactory.createSocket()
        }
        raw.use {
            it.connect(InetSocketAddress(address.ip,port),3500)
            it.soTimeout=12000
            (tls.socketFactory.createSocket(it,address.ip,port,true) as SSLSocket).use { socket ->
                socket.enabledProtocols=socket.supportedProtocols.filter { protocol -> protocol=="TLSv1.2" || protocol=="TLSv1.3" }.toTypedArray()
                socket.soTimeout=12000; socket.startHandshake()
                // Mutations and reads share a serial queue with password verification.
                socket.soTimeout=90000
                writeFrame(socket.outputStream,request,MAX_REQUEST)
                return readFrame(socket.inputStream,MAX_RESPONSE)
            }
        }
    }
}
