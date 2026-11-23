package nl.werdens.sjpeelavond;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import org.junit.Test;

/**
 * De proef op het lezen van een QR-code.
 *
 * Er is geen camera en geen toestel voor nodig: de proef maakt zelf een QR-code met
 * dezelfde bibliotheek, zet die om naar het beeldformaat van de camera (NV21) en eist
 * dat {@link QrLezer} de tekst er weer uithaalt. Zo is te controleren dat het leeswerk
 * klopt, ook als er nooit een telefoon bij is.
 */
public class QrLezerTest {

    private static final int MAAT = 420;

    private static byte[] beeld(String tekst) throws Exception {
        BitMatrix matrix = new QRCodeWriter().encode(tekst, BarcodeFormat.QR_CODE, MAAT, MAAT);
        boolean[][] donker = new boolean[matrix.getHeight()][matrix.getWidth()];
        for (int y = 0; y < matrix.getHeight(); y++) {
            for (int x = 0; x < matrix.getWidth(); x++) {
                donker[y][x] = matrix.get(x, y);
            }
        }
        return QrLezer.naarNv21(donker, matrix.getWidth(), matrix.getHeight());
    }

    @Test
    public void leestHetAdresVanEenHitsterKaartje() throws Exception {
        String code = "https://www.hitstergame.com/nl/aaaa0001/00308";
        assertEquals(code, QrLezer.lees(beeld(code), MAAT, MAAT));
    }

    @Test
    public void leestOokEenKaartnummerZonderAdres() throws Exception {
        assertEquals("aaaa0001/00308", QrLezer.lees(beeld("aaaa0001/00308"), MAAT, MAAT));
    }

    @Test
    public void leestEenOudKaartjeZonderEditie() throws Exception {
        String code = "http://www.hitstergame.com/de/00268";
        assertEquals(code, QrLezer.lees(beeld(code), MAAT, MAAT));
    }

    @Test
    public void zonderCodeInHetBeeldNiets() {
        byte[] egaal = QrLezer.naarNv21(new boolean[MAAT][MAAT], MAAT, MAAT);
        assertNull(QrLezer.lees(egaal, MAAT, MAAT));
        assertNull(QrLezer.lees(null, MAAT, MAAT));
        assertNull(QrLezer.lees(new byte[16], 0, 0));
    }
}
