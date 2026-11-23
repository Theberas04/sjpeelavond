package nl.werdens.sjpeelavond;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

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
            runOnUiThread(() -> startActivityForResult(new Intent(MainActivity.this, Scanner.class), VERZOEK_SCAN));
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
