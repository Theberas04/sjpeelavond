package nl.werdens.sjpeelavond;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

/**
 * Een camerabeeld lezen: zit er een QR-code in?
 *
 * Zonder Android-imports, zodat het met javac/java na te rekenen is: de proef bouwt
 * zelf een QR-code, zet die om naar het beeldformaat van de camera (NV21) en eist dat
 * deze lezer de tekst er weer uit haalt. Zo is het leeswerk te controleren zonder
 * toestel en zonder camera.
 */
public final class QrLezer {

    private QrLezer() {
    }

    /**
     * Leest één beeld in NV21 (het formaat dat de camera levert).
     *
     * @return de tekst uit de QR-code, of null als er geen code in het beeld zit.
     */
    public static String lees(byte[] beeld, int breedte, int hoogte) {
        if (beeld == null || breedte <= 0 || hoogte <= 0) return null;
        MultiFormatReader lezer = new MultiFormatReader();
        try {
            PlanarYUVLuminanceSource bron =
                    new PlanarYUVLuminanceSource(beeld, breedte, hoogte, 0, 0, breedte, hoogte, false);
            BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(bron));
            Result uitkomst = lezer.decodeWithState(bitmap);
            return uitkomst == null ? null : uitkomst.getText();
        } catch (NotFoundException niets) {
            return null;
        } catch (Exception fout) {
            return null;
        } finally {
            lezer.reset();
        }
    }

    /**
     * Een zwart-witbeeld (zoals een QR-code eruitziet) omzetten naar NV21, het formaat
     * van de camera. Alleen de grijswaardenlaag wordt gevuld; de kleurenlaag laat deze
     * lezer toch links liggen. De proef gebruikt dit om een beeld te maken.
     */
    public static byte[] naarNv21(boolean[][] donker, int breedte, int hoogte) {
        byte[] beeld = new byte[breedte * hoogte * 3 / 2];
        for (int y = 0; y < hoogte; y++) {
            for (int x = 0; x < breedte; x++) {
                boolean zwart = y < donker.length && x < donker[y].length && donker[y][x];
                beeld[y * breedte + x] = (byte) (zwart ? 0 : 255);
            }
        }
        for (int i = breedte * hoogte; i < beeld.length; i++) beeld[i] = (byte) 128;
        return beeld;
    }
}
