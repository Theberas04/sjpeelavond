package nl.werdens.sjpeelavond;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;

import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Een camerabeeld lezen: zit er een QR-code in?
 *
 * Zonder Android-imports, zodat het met javac/java na te rekenen is: de proef bouwt zelf
 * een QR-code, zet die om naar het beeldformaat van de camera (NV21) en eist dat deze
 * lezer de tekst er weer uit haalt. Zo is het leeswerk te controleren zonder toestel en
 * zonder camera.
 *
 * Waarom er meer dan één poging nodig is: de kaartjes van de spellen zijn niet allemaal
 * zwart op wit. Die van Hittepetit zijn roze op wit, met daaromheen een donkere tafel. Met
 * de gewone drempel (HybridBinarizer) valt zo'n code weg — de app leest het kaartje dan
 * niet terwijl de camera het prima ziet. Daarom wordt hetzelfde beeld ook met een opgerekt
 * contrast en met de kleuren omgedraaid aangeboden, en met TRY_HARDER erbij voor kleine of
 * dicht op elkaar gezette codes.
 */
public final class QrLezer {

    /** Alles onder deze grijswaarde is in het opgerekte beeld zwart: tafel, schaduw. */
    private static final int ONDERGRENS = 110;

    /**
     * Wat er op een kaartje kan staan is een QR-code; de rest staat erbij omdat een enkele
     * kaart weleens een streepjescode heeft.
     */
    private static final List<BarcodeFormat> SOORTEN = Arrays.asList(
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.AZTEC,
            BarcodeFormat.PDF_417,
            BarcodeFormat.CODE_128);

    private QrLezer() {
    }

    /**
     * Leest één beeld in NV21 (het formaat dat de camera levert).
     *
     * @return de tekst uit de QR-code, of null als er geen code in het beeld zit.
     */
    public static String lees(byte[] beeld, int breedte, int hoogte) {
        if (beeld == null || breedte <= 0 || hoogte <= 0) return null;

        // 1. Zoals het binnenkomt: zwart op wit en goed belicht.
        String uit = poging(beeld, breedte, hoogte, false, false);
        if (uit != null) return uit;

        // 2. Contrast opgerekt: een lichte kleur op wit (de roze kaartjes) heeft te weinig
        //    verschil voor de gewone drempel, zeker met een donkere achtergrond eromheen.
        byte[] sterker = rekBovenin(beeld, breedte, hoogte);
        uit = poging(sterker, breedte, hoogte, false, false);
        if (uit != null) return uit;

        // 3. Hetzelfde beeld omgedraaid: kaartjes die licht op donker staan.
        uit = poging(sterker, breedte, hoogte, true, false);
        if (uit != null) return uit;

        // 4. Een andere drempel (over het hele beeld): bij egaal licht soms beter.
        return poging(beeld, breedte, hoogte, false, true);
    }

    /**
     * Eén leespoging.
     *
     * @param omgedraaid ook proberen met donker en licht verwisseld
     * @param egaal     de drempel over het hele beeld nemen in plaats van per stukje
     */
    private static String poging(byte[] beeld, int breedte, int hoogte, boolean omgedraaid, boolean egaal) {
        MultiFormatReader lezer = new MultiFormatReader();
        try {
            Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
            hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
            hints.put(DecodeHintType.POSSIBLE_FORMATS, SOORTEN);
            if (omgedraaid) hints.put(DecodeHintType.ALSO_INVERTED, Boolean.TRUE);
            lezer.setHints(hints);

            PlanarYUVLuminanceSource bron =
                    new PlanarYUVLuminanceSource(beeld, breedte, hoogte, 0, 0, breedte, hoogte, false);
            BinaryBitmap bitmap = new BinaryBitmap(
                    egaal ? new GlobalHistogramBinarizer(bron) : new HybridBinarizer(bron));
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
     * Het beeld "bovenin" oprekken: alles onder {@link #ONDERGRENS} wordt zwart en het stuk
     * daarboven wordt over de volle reeks uitgespreid. Daarmee komt een lichte kleur op wit
     * (roze op wit bij Hittepetit) wel los van de achtergrond.
     *
     * Alleen de grijswaardenlaag (de eerste breedte×hoogte bytes) wordt aangeraakt; de
     * kleurenlaag die erachter zit laat deze lezer toch liggen.
     */
    public static byte[] rekBovenin(byte[] beeld, int breedte, int hoogte) {
        int aantal = breedte * hoogte;
        if (beeld == null || beeld.length < aantal) return beeld;
        byte[] uit = beeld.clone();
        int bereik = 255 - ONDERGRENS;
        for (int i = 0; i < aantal; i++) {
            int grijs = beeld[i] & 0xFF;
            int nieuw = grijs <= ONDERGRENS ? 0 : (grijs - ONDERGRENS) * 255 / bereik;
            uit[i] = (byte) (nieuw > 255 ? 255 : nieuw);
        }
        return uit;
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
