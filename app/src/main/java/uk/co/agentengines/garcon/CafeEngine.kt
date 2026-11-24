package uk.co.agentengines.garcon

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import app.cash.quickjs.QuickJs
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.Executors
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

interface EngineNative {
    fun sql(operation: String, statement: String, args: String): String
    fun uuid(): String
    fun randomHex(bytes: Int): String
    fun sha256(text: String): String
    fun londonDay(millis: String): String
    fun passwordHash(secret: String): String
    fun passwordMatches(secret: String, encoded: String): Boolean
}
interface DomainRoutes { fun handle(payload: String, peer: String, local: Boolean): String }

private class AndroidStore(context: Context, databaseName: String) : EngineNative, Closeable {
    private val random = SecureRandom()
    private val db = context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null).apply {
        enableWriteAheadLogging()
        setForeignKeyConstraintsEnabled(true)
        rawQuery("PRAGMA secure_delete=ON",null).use { it.moveToFirst() }
    }
    override fun uuid() = UUID.randomUUID().toString()
    override fun randomHex(bytes: Int) = ByteArray(bytes).also(random::nextBytes).hex()
    override fun sha256(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).hex()
    override fun londonDay(millis: String) = Instant.ofEpochMilli(millis.toLong()).atZone(ZoneId.of("Europe/London")).toLocalDate().toString()
    private fun derive(secret: String, salt: String): String {
        val spec = PBEKeySpec(secret.toCharArray(), salt.toByteArray(Charsets.US_ASCII), 210000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded.hex() }
        finally { spec.clearPassword() }
    }
    override fun passwordHash(secret: String): String {
        val salt = randomHex(16)
        return "p1:$salt:${derive(secret,salt)}"
    }
    override fun passwordMatches(secret: String, encoded: String): Boolean {
        val parts = encoded.split(':')
        return parts.size == 3 && parts[0] == "p1" && MessageDigest.isEqual(
            derive(secret,parts[1]).toByteArray(),parts[2].toByteArray())
    }
    override fun sql(operation: String, statement: String, args: String): String = try {
        val items = JSONArray(args)
        val values = Array<Any?>(items.length()) { if(items.isNull(it)) null else items.get(it) }
        val result: Any = when(operation) {
            "exec" -> {
                for (part in statement.split(';').map { it.trim() }.filter { it.isNotEmpty() }) {
                    when(part) {
                        "BEGIN IMMEDIATE" -> db.beginTransactionNonExclusive()
                        "COMMIT" -> { db.setTransactionSuccessful(); db.endTransaction() }
                        "ROLLBACK" -> if(db.inTransaction()) db.endTransaction()
                        else -> db.execSQL(part)
                    }
                }
                true
            }
            "run" -> { db.execSQL(statement,values); true }
            "query" -> {
                val rows = JSONArray()
                db.rawQuery(statement, Array(values.size) { values[it]?.toString() }).use { c ->
                    while(c.moveToNext()) {
                        val row = JSONObject()
                        for(i in 0 until c.columnCount) row.put(c.getColumnName(i), when(c.getType(i)) {
                            Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
                            Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
                            Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
                            else -> c.getString(i)
                        })
                        rows.put(row)
                    }
                }
                rows
            }
            else -> error("Unexpected database operation")
        }
        JSONObject().put("value",result).toString()
    } catch(_: Exception) { """{"error":"Database operation failed"}""" }
    override fun close() = db.close()
}

/** Confine QuickJS and every transaction to one thread, including startup and shutdown. */
class CafeEngine(context: Context, databaseName: String = "cafe.sqlite") : Closeable {
    private val worker = Executors.newSingleThreadExecutor()
    private val store: AndroidStore
    private val runtime: QuickJs
    private val routes: DomainRoutes
    init {
        val handles = worker.submit<Triple<AndroidStore,QuickJs,DomainRoutes>> {
            val storage = AndroidStore(context.applicationContext, databaseName)
            val js = QuickJs.create()
            try {
                js.set("Native",EngineNative::class.java,storage)
                js.evaluate(context.assets.open("engine/cafe.js").bufferedReader().use { it.readText() },"cafe.js")
                Triple(storage,js,js.get("Service",DomainRoutes::class.java))
            } catch(t:Throwable){ js.close();storage.close();throw t }
        }
        try { val h=handles.get();store=h.first;runtime=h.second;routes=h.third }
        catch(t:Throwable){ worker.shutdown();throw t }
    }
    fun request(payload: String, peer: String, local: Boolean): String =
        worker.submit<String> { routes.handle(payload,peer,local) }.get()
    override fun close() {
        worker.submit { runtime.close();store.close() }.get()
        worker.shutdown()
    }
}
