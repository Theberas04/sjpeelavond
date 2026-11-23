package nl.werdens.sjpeelavond;

import java.util.Arrays;
import java.util.List;

/**
 * Welke schermen de schil via een intent-extra mag openen.
 *
 * Bewust zonder Android-imports: zo is deze klasse met javac/java na te rekenen
 * (zie android/tests/SchermenTest.java) en kan een nieuwe schermnaam niet stil
 * buiten de lijst vallen.
 */
public final class Schermen {

    private static final List<String> TOEGESTAAN = Arrays.asList(
            "instellen",
            "spel",
            "spel-kaart",
            "hittepetit",
            "muziek",
            "uitleg");

    private Schermen() {
    }

    /** Geeft de schermnaam terug als hij bestaat, anders null. */
    public static String uit(String naam) {
        if (naam == null) return null;
        String schoon = naam.trim();
        if (schoon.isEmpty()) return null;
        if (!TOEGESTAAN.contains(schoon)) return null;
        return schoon;
    }

    /** Alles wat de pagina zelf als diepe link kent; de rooktest loopt deze lijst af. */
    public static List<String> alle() {
        return TOEGESTAAN;
    }
}
