package nl.werdens.sjpeelavond;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Het enige wat de app naar buiten vraagt: het muziekfragment en de gegevens van een
 * gescand kaartje.
 *
 * De pagina mag dat niet zelf: Deezer en Spotify sturen geen CORS-kop mee, dus een
 * verzoek uit de WebView wordt door de browser tegengehouden. Daarom doet de schil het
 * verzoek en geeft het antwoord als één JSON-regel terug
 * ({@code {ok, status, tekst, fout}}).
 *
 * Alleen Deezer, iTunes en Spotify staan op de lijst: zonder die grens zou de pagina
 * een open deur naar het hele internet zijn.
 *
 * Zonder Android-imports, zodat het met javac/java na te rekenen is.
 */
public final class Buiten {

    public static final List<String> GASTEN = Arrays.asList("api.deezer.com", "itunes.apple.com", "open.spotify.com");
    private static final int TIJD_LIMIET_MS = 8000;
    private static final int MAX_BYTES = 512 * 1024;

    private Buiten() {
    }

    /** Mag de app dit adres ophalen? */
    public static boolean mag(String url) {
        if (url == null) return false;
        try {
            URL adres = new URL(url);
            if (!"https".equalsIgnoreCase(adres.getProtocol())) return false;
            String gastheer = adres.getHost();
            if (gastheer == null) return false;
            return GASTEN.contains(gastheer.toLowerCase(Locale.ROOT));
        } catch (Exception fout) {
            return false;
        }
    }

    /** Bouwt het antwoord dat de pagina leest. */
    public static String envelop(boolean ok, int status, String tekst, String fout) {
        StringBuilder uit = new StringBuilder(tekst == null ? 64 : tekst.length() + 64);
        uit.append("{\"ok\":").append(ok);
        uit.append(",\"status\":").append(status);
        uit.append(",\"tekst\":");
        if (tekst == null) uit.append("null");
        else uit.append('"').append(ontsnap(tekst)).append('"');
        uit.append(",\"fout\":");
        if (fout == null) uit.append("null");
        else uit.append('"').append(ontsnap(fout)).append('"');
        uit.append('}');
        return uit.toString();
    }

    private static String ontsnap(String tekst) {
        StringBuilder uit = new StringBuilder(tekst.length() + 16);
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
        return uit.toString();
    }

    /** Haalt het adres op en geeft de envelop terug. */
    public static String haal(String url, String userAgent) {
        if (!mag(url)) return envelop(false, 0, null, "deze website mag niet opgevraagd worden");
        HttpURLConnection verbinding = null;
        try {
            verbinding = (HttpURLConnection) new URL(url).openConnection();
            verbinding.setConnectTimeout(TIJD_LIMIET_MS);
            verbinding.setReadTimeout(TIJD_LIMIET_MS);
            verbinding.setInstanceFollowRedirects(true);
            verbinding.setRequestProperty("User-Agent", userAgent);
            // Deezer en iTunes antwoorden in JSON, de Spotify-embedpagina is HTML.
            boolean html = "open.spotify.com".equalsIgnoreCase(new URL(url).getHost());
            verbinding.setRequestProperty("Accept", html ? "text/html,application/xhtml+xml" : "application/json");
            int code = verbinding.getResponseCode();
            if (code < 200 || code >= 300) {
                return envelop(false, code, null, "antwoord " + code);
            }
            String tekst = lees(verbinding.getInputStream());
            return envelop(true, code, tekst, null);
        } catch (Exception fout) {
            String reden = fout.getMessage() == null ? fout.getClass().getSimpleName() : fout.getMessage();
            return envelop(false, 0, null, "geen verbinding (" + reden + ")");
        } finally {
            if (verbinding != null) verbinding.disconnect();
        }
    }

    private static String lees(InputStream stroom) throws Exception {
        ByteArrayOutputStream uit = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int gelezen;
        while ((gelezen = stroom.read(buffer)) > 0) {
            uit.write(buffer, 0, gelezen);
            if (uit.size() > MAX_BYTES) throw new Exception("antwoord te groot");
        }
        return new String(uit.toByteArray(), "UTF-8");
    }
}
