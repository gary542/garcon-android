package uk.co.agentengines.garcon

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.*
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.Executors
import android.util.Base64

const val ORIGIN="https://cafe.garcon.invalid"
class Station(private val ctx:Context, val remote:CafeAddress?) {
    private val prefs=ctx.getSharedPreferences("auth-"+(remote?.pin?:"host"),Context.MODE_PRIVATE)
    private val link=remote?.let { CafeLink(it,context=ctx.applicationContext) }
    @Synchronized fun request(path:String,data:String):JSONObject {
        try {
            val request=JSONObject().put("path",path).put("data",if(data=="null") JSONObject.NULL else JSONObject(data))
                .put("session",prefs.getString("session","")).put("pair",prefs.getString("pair",""))
            val result=if(link==null) CafeHostService.current?.request(request.toString(),"host",true)
                ?: return JSONObject(failure("The café host is starting. Please try again."))
                else link.request(request.toString())
            val response=JSONObject(result)
            response.optJSONObject("auth")?.let { change ->
                val edit=prefs.edit()
                for(k in listOf("session","pair")) if(change.has(k)) edit.putString(k,change.getString(k))
                edit.commit()
            }
            response.remove("auth")
            return response
        } catch(_:Exception) {
            return JSONObject(failure("Café host unavailable. Check the host phone and café Wi-Fi, then retry."))
        }
    }
}
class Workstation(context:Context,private val station:Station,
                  private val photoPicker:(ValueCallback<Array<Uri>>)->Unit) : WebView(context) {
    private val tasks=Executors.newSingleThreadExecutor()
    @Volatile private var closed=false
    private val baseUri=Uri.parse(ORIGIN)
    private fun denied()=WebResourceResponse("text/plain","UTF-8",404,"Not Found",emptyMap(),ByteArrayInputStream(ByteArray(0)))
    init {
        settings.javaScriptEnabled=true
        settings.domStorageEnabled=true
        settings.allowFileAccess=false
        settings.allowContentAccess=false
        settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically=false
        settings.setSupportMultipleWindows(false)
        setBackgroundColor(android.graphics.Color.rgb(16,18,20))
        addJavascriptInterface(object {
            @JavascriptInterface fun hosting()=station.remote==null
            @JavascriptInterface fun uuid()=UUID.randomUUID().toString()
            @JavascriptInterface fun request(id:Int,path:String,data:String) {
                if(closed || path.length>1024 || data.length>750000) return
                runCatching { tasks.execute {
                    val result=station.request(path,data)
                    val json=JSONObject.quote(result.toString())
                    post { if(!closed) evaluateJavascript("window.cafeResult($id, JSON.parse($json))",null) }
                } }
            }
        },"Mobile")
        webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(v:WebView?,r:WebResourceRequest?)=true
            override fun shouldInterceptRequest(v:WebView?,req:WebResourceRequest):WebResourceResponse {
                val url=req.url
                if(url.scheme!=baseUri.scheme || url.encodedAuthority!=baseUri.encodedAuthority || req.method!="GET")return denied()
                val path=url.path.orEmpty().removePrefix("/")
                if(path.startsWith("api/image/") && !closed){
                    val image=station.request(path.removePrefix("api/"),"null").optJSONObject("data")?.optString("image").orEmpty()
                    if(!image.startsWith("data:image/"))return denied()
                    return WebResourceResponse(image.substringAfter("data:").substringBefore(';'),null,
                        ByteArrayInputStream(Base64.decode(image.substringAfter(','),Base64.DEFAULT)))
                }
                val asset=path.ifEmpty { "index.html" }
                if(asset.contains("..") || !asset.matches(Regex("[a-zA-Z0-9/_.-]+")))return denied()
                val mime=when(asset.substringAfterLast('.')){
                    "html"->"text/html";"css"->"text/css";"js"->"application/javascript";"png"->"image/png"
                    "svg"->"image/svg+xml";"ttf"->"font/ttf";else->return denied()
                }
                val stream=try { context.assets.open("web/$asset") } catch(_:Exception){return denied()}
                return WebResourceResponse(mime,if(mime.startsWith("text")||mime.endsWith("javascript"))"UTF-8" else null,
                    200,"OK",mapOf("Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"),stream)
            }
        }
        webChromeClient=object:WebChromeClient(){
            override fun onShowFileChooser(v:WebView?,callback:ValueCallback<Array<Uri>>,params:FileChooserParams?):Boolean {
                photoPicker(callback);return true
            }
        }
        loadUrl("$ORIGIN/")
    }
    override fun destroy(){closed=true;tasks.shutdownNow();removeJavascriptInterface("Mobile");super.destroy()}
}
