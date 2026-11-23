/**
 * Natrekken van de grens die de schil aanhoudt (alleen Deezer en iTunes) en van het
 * antwoord dat de pagina leest — zonder Android erbij.
 * Draaien: javac -d out-test app/src/main/java/nl/werdens/sjpeelavond/Buiten.java tests/BuitenTest.java && java -cp out-test BuitenTest
 */
import nl.werdens.sjpeelavond.Buiten;

public class BuitenTest {

    private static int fouten = 0;

    private static void eis(boolean voorwaarde, String uitleg) {
        if (!voorwaarde) {
            System.out.println("FOUT: " + uitleg);
            fouten++;
        }
    }

    public static void main(String[] args) {
        eis(Buiten.mag("https://api.deezer.com/track/3135556"), "Deezer hoort te mogen");
        eis(Buiten.mag("https://itunes.apple.com/search?term=x"), "iTunes hoort te mogen");
        eis(!Buiten.mag("http://api.deezer.com/track/1"), "zonder https niet");
        eis(!Buiten.mag("https://api.deezer.com.evil.example/track/1"), "een gastheer die erop lijkt mag niet");
        eis(!Buiten.mag("https://192.168.1.10/router"), "het eigen netwerk mag niet");
        eis(!Buiten.mag("https://localhost:8080/x"), "localhost mag niet");
        eis(!Buiten.mag("file:///etc/passwd"), "een bestand mag niet");
        eis(!Buiten.mag("niet eens een adres"), "onzin mag niet");
        eis(!Buiten.mag(""), "leeg mag niet");
        eis(!Buiten.mag(null), "null mag niet");

        String schoon = Buiten.envelop(true, 200, "{\"preview\":\"https://x/1.mp3\"}", null);
        eis(schoon.equals("{\"ok\":true,\"status\":200,\"tekst\":\"{\\\"preview\\\":\\\"https://x/1.mp3\\\"}\",\"fout\":null}"),
                "envelop zonder escapes klopt niet: " + schoon);

        String lastig = Buiten.envelop(false, 0, null, "regel1\nregel2 \"tussen aanhalingstekens\"");
        eis(lastig.equals("{\"ok\":false,\"status\":0,\"tekst\":null,\"fout\":\"regel1\\nregel2 \\\"tussen aanhalingstekens\\\"\"}"),
                "envelop met escapes klopt niet: " + lastig);

        String leeg = Buiten.envelop(false, 0, null, null);
        eis(leeg.equals("{\"ok\":false,\"status\":0,\"tekst\":null,\"fout\":null}"), "lege envelop klopt niet: " + leeg);

        String geweigerd = Buiten.haal("https://voorbeeld.example/x", "Sjpeelavond/test");
        eis(geweigerd.contains("\"ok\":false"), "een vreemd adres hoort geweigerd te worden: " + geweigerd);

        System.out.println(fouten == 0 ? "BuitenTest: ok" : "BuitenTest: " + fouten + " fout(en)");
        if (fouten > 0) System.exit(1);
    }
}
