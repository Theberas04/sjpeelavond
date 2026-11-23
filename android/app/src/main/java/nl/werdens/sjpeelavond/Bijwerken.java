package nl.werdens.sjpeelavond;

/**
 * Het rekenwerk achter "bijwerken": de downloadlink van een uitgave omzetten in een
 * veilige bestandsnaam.
 *
 * Gewone Java zonder Android erin, zodat het met een proef op de computer na te rekenen
 * is in plaats van "we hopen dat het op een telefoon klopt". De rest van het bijwerken
 * (downloaden en aan de installateur geven) zit in {@link MainActivity}.
 */
public final class Bijwerken {

    private Bijwerken() {
    }

    /**
     * De bestandsnaam uit een downloadlink, veilig gemaakt voor het cache-bestand.
     * Geeft null als er geen bruikbare .apk-naam in zit.
     */
    public static String bestandsnaam(String url) {
        if (url == null) return null;
        int vraag = url.indexOf('?');
        String pad = vraag >= 0 ? url.substring(0, vraag) : url;
        int schuin = pad.lastIndexOf('/');
        String naam = schuin >= 0 ? pad.substring(schuin + 1) : pad;
        naam = naam.replaceAll("[^A-Za-z0-9._-]", "_");
        if (naam.isEmpty() || !naam.endsWith(".apk")) return null;
        // Nooit een naam die met een punt begint: dan kan een link een verborgen bestand
        // of een pad omhoog ("..") proberen te maken.
        if (naam.startsWith(".")) return null;
        return naam;
    }
}
