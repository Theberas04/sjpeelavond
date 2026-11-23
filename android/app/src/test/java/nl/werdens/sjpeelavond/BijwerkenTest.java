package nl.werdens.sjpeelavond;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Proeven op het bijwerken: de downloadlink omzetten in een veilige bestandsnaam.
 *
 * Dit is precies het stuk waar een fout stil kwaad doet — een verkeerde naam schrijft
 * buiten de cachemap of geeft de installateur een bestand dat geen APK is.
 */
public class BijwerkenTest {

    @Test
    public void haaltDeBestandsnaamUitDeLink() {
        assertEquals("Sjpeelavond-Android-1.4.0.apk",
                Bijwerken.bestandsnaam("https://github.com/Theberas04/sjpeelavond/releases/download/v1.4.0/Sjpeelavond-Android-1.4.0.apk"));
    }

    @Test
    public void laatEenVraagtekenEnWatErnaKomtWeg() {
        assertEquals("app.apk", Bijwerken.bestandsnaam("https://voorbeeld.nl/download/app.apk?token=abc&x=1"));
    }

    @Test
    public void weigertWatGeenApkIs() {
        assertNull(Bijwerken.bestandsnaam("https://voorbeeld.nl/update.zip"));
        assertNull(Bijwerken.bestandsnaam("https://voorbeeld.nl/"));
        assertNull(Bijwerken.bestandsnaam(null));
        assertNull(Bijwerken.bestandsnaam(""));
    }

    @Test
    public void laatNooitEenPadOmhoogToe() {
        // Een kwaadwillende link mag niet buiten de cachemap kunnen schrijven.
        assertEquals("app.apk", Bijwerken.bestandsnaam("https://voorbeeld.nl/../../etc/app.apk"));
        assertEquals("app.apk", Bijwerken.bestandsnaam("../../etc/app.apk"));
        assertNull(Bijwerken.bestandsnaam("https://voorbeeld.nl/..apk"));
    }

    @Test
    public void maaktVreemdeTekensVeilig() {
        assertEquals("mijn_app_v2.apk", Bijwerken.bestandsnaam("https://voorbeeld.nl/mijn app v2.apk"));
        assertEquals("app.apk", Bijwerken.bestandsnaam("https://voorbeeld.nl/../app.apk"));
    }
}
