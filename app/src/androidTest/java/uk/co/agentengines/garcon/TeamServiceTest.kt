package uk.co.agentengines.garcon

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import javax.net.ssl.SSLException

internal fun json(vararg items: Pair<String,Any?>) = JSONObject().apply {
    for((k,v) in items)put(k,v ?: JSONObject.NULL)
}
internal class Phone(val call:(String)->String){
    private val auth=JSONObject()
    fun request(path:String,data:JSONObject?=null,status:Int=200):JSONObject{
        val payload=json("path" to path,"data" to data,"pair" to auth.optString("pair"),"session" to auth.optString("session"))
        val response=JSONObject(call(payload.toString()))
        assertEquals("$path: ${response.optJSONObject("data")?.optString("error")}",status,response.getInt("status"))
        response.optJSONObject("auth")?.let {for(k in it.keys())auth.put(k,it.get(k))}
        return response.getJSONObject("data")
    }
    fun cmd(type:String,vararg fields:Pair<String,Any?>,key:String=UUID.randomUUID().toString(),status:Int=200)=
        request("command",json("key" to key,"command" to json("type" to type,*fields)),status)
    fun state()=request("state").getJSONObject("state")
}

@RunWith(AndroidJUnit4::class)
class TeamServiceTest {
    @Test fun threeIndependentTeamSessionsShareOneOrderAndSurviveRestart(){
        val context=ApplicationProvider.getApplicationContext<Context>()
        val db="team-test-${UUID.randomUUID()}.sqlite"
        val secret=UUID.randomUUID().toString()
        val teamSecret=UUID.randomUUID().toString()
        val email="team@example.invalid"
        try {
            CafeEngine(context,db).use { engine ->
                val owner=Phone {engine.request(it,"device",true)}
                CafeListener(context,engine,0).use { endpoint ->
                    val addr=CafeAddress("127.0.0.1",endpoint.pin)
                    try {
                        CafeLink(addr.copy(pin="0".repeat(64)),endpoint.port).request("""{"path":"info"}""")
                        fail("Expected a certificate mismatch")
                    } catch(_:SSLException) {}
                    val isolated=Phone(CafeLink(addr,endpoint.port)::request)
                    val setup=json("name" to "Service test","email" to email,"password" to secret)
                    isolated.request("setup",setup,403)
                    owner.request("setup",setup)
                    owner.cmd("team.password","password" to teamSecret)
                    val menu=owner.cmd("menu.save","name" to "Lunch").getString("id")
                    val product=owner.cmd("product.save","name" to "Soup","menu" to menu,"price" to 425,"available" to true).getString("id")
                    val table=owner.cmd("table.save","label" to "7").getString("id")
                    fun employee(slot:String)=Phone(CafeLink(addr,endpoint.port)::request).apply {
                        request("team-login",json("email" to email,"password" to teamSecret))
                        request("staff-login",json("slot" to slot))
                    }
                    val waiter=employee("Waiter-1")
                    val chef=employee("Chef-1")
                    val cashier=employee("Cashier-1")
                    val lines=JSONArray().put(json("item" to product,"quantity" to 2,"note" to "No cream","price" to 425))
                    val key=UUID.randomUUID().toString()
                    fun send()=waiter.cmd("order.submit","table" to table,"lines" to lines,"bill" to null,key=key)
                    val ticket=send().getString("id")
                    assertEquals(ticket,send().getString("id"))
                    val received=chef.state().getJSONArray("tickets")
                    assertEquals(1,received.length())
                    assertEquals("No cream",received.getJSONObject(0).getJSONArray("lines").getJSONObject(0).getString("note"))
                    val bill=cashier.state().getJSONArray("bills").getJSONObject(0)
                    assertEquals(850,bill.getInt("total"))
                    fun pay(status:Int)=cashier.cmd("bill.paid","id" to bill.getString("id"),"revision" to bill.getInt("revision"),"amount" to 850,status=status)
                    pay(400)
                    waiter.cmd("ticket.status","id" to ticket,"status" to "Preparing",status=403)
                    chef.cmd("ticket.status","id" to ticket,"status" to "Preparing")
                    chef.cmd("ticket.status","id" to ticket,"status" to "AtTill")
                    assertEquals("AtTill",cashier.state().getJSONArray("tickets").getJSONObject(0).getString("status"))
                    pay(200)
                    assertEquals(0,waiter.state().getJSONArray("bills").length())
                    assertEquals(0,chef.state().getJSONArray("tickets").length())
                }
            }
            CafeEngine(context,db).use { engine ->
                val owner=Phone{engine.request(it,"device",true)}
                owner.request("login",json("email" to email,"password" to secret))
                val state=owner.state()
                assertEquals(1,state.getJSONArray("products").length())
                val paid=state.getJSONArray("paid").getJSONObject(0)
                assertEquals("Cashier 1",paid.getString("paidBy"))
                assertFalse(paid.has("amount")||paid.has("total"))
            }
        } finally {context.deleteDatabase(db)}
    }
}
