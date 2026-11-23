/**
 * Natrekken van de schermnamen die de schil accepteert, zonder Android erbij.
 * Draaien: javac -d out-test app/src/main/java/nl/werdens/sjpeelavond/Schermen.java tests/SchermenTest.java && java -cp out-test SchermenTest
 */
import java.util.List;
import nl.werdens.sjpeelavond.Schermen;

public class SchermenTest {

    private static int fouten = 0;

    private static void eis(boolean voorwaarde, String uitleg) {
        if (!voorwaarde) {
            System.out.println("FOUT: " + uitleg);
            fouten++;
        }
    }

    public static void main(String[] args) {
        for (String naam : Schermen.alle()) {
            eis(naam.equals(Schermen.uit(naam)), "eigen schermnaam geweigerd: " + naam);
            eis(naam.equals(Schermen.uit("  " + naam + "  ")), "spaties rond " + naam + " horen te mogen");
        }
        String[] geweigerd = {"", "  ", null, "beheer", "spel16", "javascript:alert(1)", "SPEL", "spel-kaart-extra", "index.html"};
        for (String naam : geweigerd) {
            eis(Schermen.uit(naam) == null, "deze naam hoort geweigerd te worden: " + naam);
        }
        List<String> alle = Schermen.alle();
        eis(alle.size() >= 5, "de lijst hoort de schermen van de app te dekken");
        eis(alle.contains("spel") && alle.contains("muziek") && alle.contains("uitleg"), "kernschermen ontbreken");
        System.out.println(fouten == 0 ? "SchermenTest: ok (" + alle.size() + " schermen)" : "SchermenTest: " + fouten + " fout(en)");
        if (fouten > 0) System.exit(1);
    }
}
