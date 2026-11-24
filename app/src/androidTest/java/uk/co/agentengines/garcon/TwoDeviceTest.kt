package uk.co.agentengines.garcon

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Explicitly invoked two-device exercise. Every run creates a separate disposable café. */
@RunWith(AndroidJUnit4::class)
class TwoDeviceTest {
    private val args get()=InstrumentationRegistry.getArguments()
    private val ctx get()=ApplicationProvider.getApplicationContext<Context>()
    private val email="test@example.invalid"
    private val team get()=requireNotNull(args.getString("testTeam"))
    private fun login(phone:Phone,slot:String):Phone=phone.apply {
        request("team-login",json("email" to email,"password" to team))
        request("staff-login",json("slot" to slot))
    }

    @Test fun floorAndTill(){
        assumeTrue(args.getString("station")=="floor")
        val port=46474
        val file=File(ctx.cacheDir,"handoff-test-pin")
        val db="handoff-${UUID.randomUUID()}.sqlite"
        try {
            CafeEngine(ctx,db).use { engine ->
                CafeListener(ctx,engine,port).use { host ->
                    val owner=Phone{engine.request(it,"device",true)}
                    owner.request("setup",json("name" to "Test café","email" to email,"password" to UUID.randomUUID().toString()))
                    owner.cmd("team.password","password" to team)
                    val menu=owner.cmd("menu.save","name" to "Breakfast").getString("id")
                    val item=owner.cmd("product.save","name" to "Flat white","menu" to menu,"price" to 320,"available" to true).getString("id")
                    val table=owner.cmd("table.save","label" to "12").getString("id")
                    val addr=CafeAddress("127.0.0.1",host.pin)
                    val waiter=login(Phone(CafeLink(addr,port)::request),"Waiter-1")
                    val cashier=login(Phone(CafeLink(addr,port)::request),"Cashier-1")
                    val ticket=waiter.cmd("order.submit","table" to table,"bill" to null,"lines" to JSONArray().put(
                        json("item" to item,"quantity" to 2,"price" to 320,"note" to "Oat milk"))).getString("id")
                    file.writeText(host.pin)
                    val deadline=System.nanoTime()+300_000_000_000L
                    while(cashier.state().getJSONArray("tickets").getJSONObject(0).getString("status")!="AtTill"){
                        check(System.nanoTime()<deadline){"Kitchen did not return ticket"};Thread.sleep(1000)
                    }
                    val state=cashier.state()
                    assertEquals(ticket,state.getJSONArray("tickets").getJSONObject(0).getString("id"))
                    val bill=state.getJSONArray("bills").getJSONObject(0)
                    assertEquals(640,bill.getInt("total"))
                    cashier.cmd("bill.paid","id" to bill.getString("id"),"revision" to bill.getInt("revision"),"amount" to 640)
                    assertEquals(0,waiter.state().getJSONArray("bills").length())
                    Thread.sleep(10000)
                }
            }
        } finally {file.delete();ctx.deleteDatabase(db)}
    }

    @Test fun kitchenOnAnotherPhone(){
        assumeTrue(args.getString("station")=="kitchen")
        val addr=CafeAddress.parse(requireNotNull(args.getString("invite")))
        val cook=login(Phone(CafeLink(addr,46474,ctx)::request),"Chef-1")
        val ticket=cook.state().getJSONArray("tickets").getJSONObject(0)
        assertEquals("12",ticket.getString("tableLabel"))
        assertEquals("Oat milk",ticket.getJSONArray("lines").getJSONObject(0).getString("note"))
        cook.cmd("ticket.status","id" to ticket.getString("id"),"status" to "Preparing")
        cook.cmd("ticket.status","id" to ticket.getString("id"),"status" to "AtTill")
        val deadline=System.nanoTime()+60_000_000_000L
        while(cook.state().getJSONArray("tickets").length()!=0){
            check(System.nanoTime()<deadline){"Settled ticket remained in the kitchen"}
            Thread.sleep(500)
        }
    }
}
