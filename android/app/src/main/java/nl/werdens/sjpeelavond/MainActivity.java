package nl.werdens.sjpeelavond;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * De schil van Sjpeelavond: één WebView met de app erin.
 *
 * De pagina, de spellogica en de muziekdatabase zitten in de app zelf
 * (assets/www); er is geen server nodig. Het enige waarvoor de app naar buiten
 * gaat is het 30-secondenfragment, en dat doet de schil omdat Deezer geen
 * CORS-kop stuurt (zie {@link Buiten}).
 */
public class MainActivity extends Activity {

    private static final String TAG = "Sjpeelavond";
    private static final String BASIS = "https://appassets.androidplatform.net/index.html";
    private static final int VERZOEK_SCAN = 1001;

    /**
     * De pagina is er nog niet meteen; deze wikkel wacht tot de app zijn haakje
     * (window.SJPEEL_SCAN) heeft aangemeld en geeft de code dan door.
     */
    private static final String JS_WACHT = "(function probeer(n, code) {"
            + " if (window.SJPEEL_SCAN) { window.SJPEEL_SCAN(code); return; }"
            + " if (n > 0) setTimeout(function () { probeer(n - 1, code); }, 200);"
            + " })(";

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private String versie = "";
    private String proefKaart = null;
    private final Handler hoofd = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        versie = versieNaam();

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.addJavascriptInterface(new Brug(), "Sjpeelavond");
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Waar de rooktest op wacht: titel, aantal spelkaarten, welk scherm open
                // staat en of het bord inhoud heeft (een leeg bord zou anders goedkeuren).
                // Niet meteen: de pagina haalt eerst de muziekdatabase uit de bundel en
                // tekent daarna, dus een momentopname bij het laden ziet nog niets.
                view.postDelayed(() -> domMomentopname(view), 2500);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost())) return false;
                String schema = uri.getScheme();
                if ("https".equalsIgnoreCase(schema) || "http".equalsIgnoreCase(schema)) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage bericht) {
                Log.i(TAG, "console " + bericht.messageLevel() + " " + bericht.message());
                return true;
            }
        });

        setContentView(webView);
        if (savedInstanceState == null) {
            webView.loadUrl(startAdres(getIntent()));
            proefKaart = proefKaartUit(getIntent());
            // Alleen in een debugversie: de rooktest laat zo de camerakant van de app lopen
            // (dezelfde weg als de knop Kaart scannen), zonder dat er iemand op hoeft te tikken.
            if (proefCameraUit(getIntent())) webView.postDelayed(this::openScanner, 800);
            // Alleen in een debugversie: de rooktest laat zo het bijwerken lopen.
            String proefUpdate = getIntent() == null ? null : getIntent().getStringExtra("update");
            if (proefUpdate != null && (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                webView.postDelayed(() -> downloadEnInstalleer(proefUpdate), 800);
            }
        } else {
            webView.restoreState(savedInstanceState);
        }
        Log.i(TAG, "Sjpeelavond klaar versie=" + versie);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String adres = startAdres(intent);
        if (intent != null && !adres.equals(BASIS)) {
            webView.loadUrl(adres);
        }
        // Een kaartcode die met het opstartcommando is meegegeven (alleen in een debugversie).
        // Dit hoort hier en niet bij het laden van de pagina: een diepe link verandert alleen
        // het hekje in het adres, dus dan laadt de pagina niet opnieuw en komt onPageFinished
        // niet langs. De pagina zelf wacht (zie JS_WACHT) tot ze zover is.
        proefKaart = proefKaartUit(intent);
        if (proefKaart != null) {
            String code = proefKaart;
            proefKaart = null;
            geefCodeDoor(code);
        }
    }

    /**
     * Een scherm openen kan alleen in een debugversie en alleen voor de namen die
     * {@link Schermen} kent: zo kan een uitgebrachte app niet van buitenaf gestuurd worden.
     */
    private String startAdres(Intent intent) {
        boolean debugbaar = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debugbaar || intent == null) return BASIS;
        String scherm = Schermen.uit(intent.getStringExtra("scherm"));
        if (scherm == null) return BASIS;
        return BASIS + "#" + scherm;
    }

    private String versieNaam() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception fout) {
            return "";
        }
    }

    /**
     * Een kaartcode die met het opstartcommando is meegegeven, en alleen in een
     * debugversie: zo kan de rooktest het scannen narekenen zonder camera. In een
     * uitgebrachte app is dit altijd null.
     */
    private String proefKaartUit(Intent intent) {
        boolean debugbaar = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debugbaar || intent == null) return null;
        String code = intent.getStringExtra("proefkaart");
        return code == null || code.trim().isEmpty() ? null : code.trim();
    }

    /** De code van een gescand kaartje aan de pagina geven. */
    private void geefCodeDoor(String code) {
        if (webView == null) return;
        if (code == null) {
            Log.i(TAG, "SJPEELAVOND_SCAN geannuleerd");
            return;
        }
        Log.i(TAG, "SJPEELAVOND_SCAN code=" + code);
        webView.evaluateJavascript(JS_WACHT + "30, " + alsJsTekst(code) + ")", null);
    }

    /** De camera openen om een kaartje te scannen; het antwoord komt via window.SJPEEL_SCAN. */
    private void openScanner() {
        if (isFinishing()) return;
        Log.i(TAG, "SJPEELAVOND_SCANNER openen");
        startActivityForResult(new Intent(this, Scanner.class), VERZOEK_SCAN);
    }

    /* ── bijwerken: de nieuwe versie zelf ophalen en aan de installateur geven ───── */

    /**
     * De nieuwe versie downloaden en aan de installateur van Android geven. Dit is
     * dezelfde weg als in Smakenland: Android laat een app alleen een gedownload bestand
     * installeren als de gebruiker die app dat zelf heeft toegestaan.
     */
    private void downloadEnInstalleer(String url) {
        // Alleen onze eigen uitgaven: een pagina mag de app niet een willekeurige APK
        // laten installeren.
        if (url == null || !url.startsWith("https://github.com/Theberas04/sjpeelavond/")) {
            Log.i(TAG, "SJPEELAVOND_UPDATE vreemde downloadlink geweigerd: " + url);
            meld("Deze downloadlink hoort niet bij Sjpeelavond.");
            return;
        }
        final String naam = Bijwerken.bestandsnaam(url);
        if (naam == null) {
            meld("De downloadlink van de nieuwe versie klopt niet.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            // Android wil eerst dat je deze app laat installeren.
            Log.i(TAG, "SJPEELAVOND_UPDATE toestemming nodig");
            meld("Zet eerst \u201conbekende apps installeren\u201d aan voor Sjpeelavond.");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception fout) {
                Log.i(TAG, "SJPEELAVOND_UPDATE instelpagina niet te openen: " + fout.getMessage());
            }
            return;
        }
        final ProgressDialog dialoog = new ProgressDialog(this);
        dialoog.setTitle("Bijwerken");
        dialoog.setMessage("Bezig met downloaden…");
        dialoog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        dialoog.setMax(100);
        dialoog.setCancelable(false);
        dialoog.show();

        new Thread(() -> {
            File doel = new File(new File(getCacheDir(), "update"), naam);
            try {
                File map = doel.getParentFile();
                if (map != null && !map.exists() && !map.mkdirs()) throw new IllegalStateException("geen map");
                download(url, doel, procent -> hoofd.post(() -> {
                    if (dialoog.isShowing()) dialoog.setProgress(procent);
                }));
                Log.i(TAG, "SJPEELAVOND_UPDATE gedownload: " + doel.getAbsolutePath()
                        + " (" + doel.length() + " bytes)");
                hoofd.post(() -> {
                    if (dialoog.isShowing()) dialoog.dismiss();
                    installeer(doel);
                });
            } catch (Exception fout) {
                Log.i(TAG, "SJPEELAVOND_UPDATE downloaden mislukt: " + fout);
                hoofd.post(() -> {
                    if (dialoog.isShowing()) dialoog.dismiss();
                    meld("Bijwerken mislukt — probeer het later opnieuw.");
                });
            }
        }).start();
    }

    private void installeer(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".bestanden", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            Log.i(TAG, "SJPEELAVOND_UPDATE installatie aangeboden");
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_UPDATE installeren mislukt: " + fout);
            meld("De nieuwe versie staat klaar, maar de installateur wilde niet openen.");
        }
    }

    private interface Voortgang {
        void bij(int procent);
    }

    /** Het APK-bestand ophalen, met de voortgang erbij zodat de balk meeloopt. */
    private void download(String adres, File doel, Voortgang voortgang) throws Exception {
        HttpURLConnection verbinding = (HttpURLConnection) new URL(adres).openConnection();
        try {
            verbinding.setConnectTimeout(10000);
            verbinding.setReadTimeout(30000);
            verbinding.setRequestProperty("User-Agent", "Sjpeelavond/" + versie);
            verbinding.setInstanceFollowRedirects(true);
            int code = verbinding.getResponseCode();
            if (code != 200) throw new IllegalStateException("status " + code);
            long totaal = verbinding.getContentLengthLong();
            try (InputStream in = verbinding.getInputStream();
                 FileOutputStream uit = new FileOutputStream(doel)) {
                byte[] buffer = new byte[16384];
                long gedaan = 0;
                int gelezen;
                while ((gelezen = in.read(buffer)) > 0) {
                    uit.write(buffer, 0, gelezen);
                    gedaan += gelezen;
                    if (totaal > 0) voortgang.bij((int) (gedaan * 100 / totaal));
                }
            }
            if (doel.length() == 0) throw new IllegalStateException("leeg bestand");
        } finally {
            verbinding.disconnect();
        }
    }

    /** Iets op het scherm zeggen; hetzelfde bericht gaat ook het logboek in. */
    private void meld(String tekst) {
        Log.i(TAG, "SJPEELAVOND_UPDATE melding: " + tekst);
        Toast.makeText(this, tekst, Toast.LENGTH_LONG).show();
    }

    /** Staat het camerascherm in het opstartcommando? Alleen een debugversie doet dat. */
    private boolean proefCameraUit(Intent intent) {
        boolean debugbaar = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        return debugbaar && intent != null && intent.getBooleanExtra("camera", false);
    }

    /**
     * Een momentopname van de pagina in het logboek zetten: waar de rooktest op wacht.
     * Draait een paar tellen na het laden, want daarvoor is de pagina nog niet klaar.
     */
    private void domMomentopname(WebView view) {
        view.evaluateJavascript(
                "['titel='+document.title,"
                        + "'spelkaarten='+document.querySelectorAll('#spelkaarten .spelkaart').length,"
                        + "'tabbladen='+document.querySelectorAll('#tabs button').length,"
                        + "'bordtekst='+(((document.querySelector('#bord')||{}).innerText)||'').length,"
                        + "'scherm='+Array.prototype.filter.call(document.querySelectorAll('#app > section'),"
                        + "function(s){return !s.hidden}).map(function(s){return s.id}).join(',')].join('|')",
                waarde -> Log.i(TAG, "DOM " + waarde));
        // Een kaartcode die met het opstartcommando is meegegeven (alleen in een
        // debugversie): zo kan de rooktest het scannen narekenen zonder camera.
        if (proefKaart != null) {
            String code = proefKaart;
            proefKaart = null;
            geefCodeDoor(code);
        }
    }

    /** Een tekst als JavaScript-tekst, met dezelfde ontsnapping als JSON. */
    static String alsJsTekst(String tekst) {
        StringBuilder uit = new StringBuilder(tekst.length() + 16);
        uit.append('"');
        for (int i = 0; i < tekst.length(); i++) {
            char c = tekst.charAt(i);
            switch (c) {
                case '"':
                    uit.append("\\\"");
                    break;
                case '\\':
                    uit.append("\\\\");
                    break;
                case '\n':
                    uit.append("\\n");
                    break;
                case '\r':
                    uit.append("\\r");
                    break;
                case '\t':
                    uit.append("\\t");
                    break;
                default:
                    if (c < 0x20) uit.append(String.format("\\u%04x", (int) c));
                    else uit.append(c);
            }
        }
        return uit.append('"').toString();
    }

    @Override
    protected void onActivityResult(int verzoek, int uitslag, Intent gegevens) {
        super.onActivityResult(verzoek, uitslag, gegevens);
        if (verzoek != VERZOEK_SCAN) return;
        String code = uitslag == RESULT_OK && gegevens != null ? gegevens.getStringExtra(Scanner.EXTRA_CODE) : null;
        geefCodeDoor(code);
    }

    /** Wat de pagina van de schil mag vragen. */
    private final class Brug {

        @JavascriptInterface
        public String lokaal() {
            return "ja";
        }

        @JavascriptInterface
        public String versie() {
            return versie;
        }

        @JavascriptInterface
        public void log(String tekst) {
            Log.i(TAG, tekst);
        }

        /** Haalt een adres op (alleen Deezer, iTunes en Spotify) en geeft {ok,status,tekst,fout} terug. */
        @JavascriptInterface
        public String bron(String url) {
            return Buiten.haal(url, "Sjpeelavond/" + versie);
        }

        /** De camera openen om een kaartje te scannen; het antwoord komt via window.SJPEEL_SCAN. */
        @JavascriptInterface
        public void scanKaart() {
            runOnUiThread(MainActivity.this::openScanner);
        }

        /**
         * De nieuwe versie ophalen en aan de installateur van Android geven. De pagina
         * meldt alleen welke versie er is; het downloaden en installeren doet de schil
         * (zie downloadEnInstalleer).
         */
        @JavascriptInterface
        public void werkBij(String url) {
            runOnUiThread(() -> downloadEnInstalleer(url));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
