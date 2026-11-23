package nl.werdens.sjpeelavond;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
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

    /**
     * Een beeld zoals de camera het maakt: een kaartje op een donkere tafel, met de code
     * in een gekozen grijswaarde. De kaartjes van Hittepetit zijn roze op wit (nagegaan op
     * een foto van een echt kaartje), dus met veel minder verschil dan zwart op wit.
     */
    private static byte[] foto(String tekst, int frameBreedte, int frameHoogte, int qrMaat,
                               int codeGrijs, int kaartGrijs, int tafelGrijs) throws Exception {
        BitMatrix matrix = new QRCodeWriter().encode(tekst, BarcodeFormat.QR_CODE, qrMaat, qrMaat);
        byte[] beeld = new byte[frameBreedte * frameHoogte * 3 / 2];
        for (int i = 0; i < frameBreedte * frameHoogte; i++) beeld[i] = (byte) tafelGrijs;

        int marge = 24;
        int kaartX = (frameBreedte - qrMaat - 2 * marge) / 2;
        int kaartY = (frameHoogte - qrMaat - 2 * marge) / 2;
        for (int y = kaartY; y < kaartY + qrMaat + 2 * marge; y++) {
            for (int x = kaartX; x < kaartX + qrMaat + 2 * marge; x++) {
                if (x < 0 || y < 0 || x >= frameBreedte || y >= frameHoogte) continue;
                beeld[y * frameBreedte + x] = (byte) kaartGrijs;
            }
        }
        for (int y = 0; y < qrMaat; y++) {
            for (int x = 0; x < qrMaat; x++) {
                int px = kaartX + marge + x;
                int py = kaartY + marge + y;
                if (px < 0 || py < 0 || px >= frameBreedte || py >= frameHoogte) continue;
                beeld[py * frameBreedte + px] = (byte) (matrix.get(x, y) ? codeGrijs : kaartGrijs);
            }
        }
        for (int i = frameBreedte * frameHoogte; i < beeld.length; i++) beeld[i] = (byte) 128;
        return beeld;
    }

    /**
     * Het kaartje van Hittepetit: roze op wit op een donkere tafel. Zo'n kaartje las de app
     * eerst niet — de gebruiker meldde "hij scant de kaarten van hittepetit niet" terwijl de
     * camera het kaartje wel zag. Hieronder staat per geval wat de lezer van vóór de
     * reparatie deed ({@link #oudeLezer}) en wat {@link QrLezer#lees} doet.
     */
    @Test
    public void leestEenRozeHittepetitKaartjeOpEenDonkereTafel() throws Exception {
        String code = "https://hittepetit.radiononnevot.nl/q/HP0077";
        byte[] beeld = foto(code, 1280, 720, 300, 135, 255, 40);
        assertEquals(code, QrLezer.lees(beeld, 1280, 720));
    }

    /** Een kaartje dat verder weg gehouden wordt: de code is dan klein in het beeld. */
    @Test
    public void leestEenKleinRozeKaartjeVerderWeg() throws Exception {
        String code = "https://hittepetit.radiononnevot.nl/q/HP0132";
        byte[] beeld = foto(code, 1280, 720, 110, 165, 255, 40);
        assertNull("de oude lezer haalde dit niet", oudeLezer(beeld, 1280, 720));
        assertEquals(code, QrLezer.lees(beeld, 1280, 720));
    }

    /** Een kaartje waarvan de code maar weinig afsteekt tegen het wit (licht roze). */
    @Test
    public void leestEenLichtRozeKaartje() throws Exception {
        String code = "https://hittepetit.radiononnevot.nl/q/HP0100";
        byte[] beeld = foto(code, 1280, 720, 320, 190, 255, 40);
        assertNull("de oude lezer haalde dit niet", oudeLezer(beeld, 1280, 720));
        assertEquals(code, QrLezer.lees(beeld, 1280, 720));
    }

    /** Een kaartje dat licht op donker staat (omgedraaid) hoort ook gelezen te worden. */
    @Test
    public void leestEenOmgedraaidKaartje() throws Exception {
        String code = "https://app.raojs.nl?id=NPRP";
        byte[] beeld = foto(code, 1280, 720, 320, 250, 30, 10);
        assertNull("de oude lezer haalde dit niet", oudeLezer(beeld, 1280, 720));
        assertEquals(code, QrLezer.lees(beeld, 1280, 720));
    }

    /**
     * Zoals de app het eerst deed: geen extra hints, alleen de drempel per stukje beeld.
     * Deze staat hier zodat de proeven hierboven kunnen laten zien dat de reparatie echt
     * iets doet: haal de extra pogingen uit {@link QrLezer#lees} en ze zakken.
     */
    private static String oudeLezer(byte[] beeld, int breedte, int hoogte) {
        MultiFormatReader lezer = new MultiFormatReader();
        try {
            PlanarYUVLuminanceSource bron =
                    new PlanarYUVLuminanceSource(beeld, breedte, hoogte, 0, 0, breedte, hoogte, false);
            Result uitkomst = lezer.decodeWithState(new BinaryBitmap(new HybridBinarizer(bron)));
            return uitkomst == null ? null : uitkomst.getText();
        } catch (NotFoundException niets) {
            return null;
        } catch (Exception fout) {
            return null;
        } finally {
            lezer.reset();
        }
    }
}
