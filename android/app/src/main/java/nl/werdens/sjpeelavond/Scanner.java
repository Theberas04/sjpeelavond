package nl.werdens.sjpeelavond;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/**
 * De camera: de QR-code van een kaartje lezen.
 *
 * Deze activity doet niets met de inhoud van de code — ze geeft de tekst terug aan
 * {@link MainActivity}, die hem aan de pagina doorgeeft. Wat een code betekent staat
 * in public/js/kaart.js, zodat het op één plek staat en na te rekenen is. Het lezen
 * zelf zit in {@link QrLezer}.
 *
 * De camera wordt met de klassieke camera-API bediend (android.hardware.Camera): dat
 * werkt vanaf Android 7 tot nu, en zo hoeft er naast ZXing geen bibliotheek bij. Het
 * beeld gaat als één grijswaardenvlak naar ZXing; dat kan tegen een gedraaid beeld,
 * want een QR-code is richtingloos.
 */
public class Scanner extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {

    public static final String EXTRA_CODE = "code";
    private static final String TAG = "Sjpeelavond";
    private static final int PERMISSIE_CAMERA = 4711;
    private static final int GEWENSTE_BREEDTE = 1280;
    /** Groter dan dit hoeft niet: dat kost alleen maar rekenwerk per beeld. */
    private static final int GEWENSTE_BREEDTE_MAX = 1920;
    private static final long MIN_TIJD_TUSSEN_POGINGEN_MS = 250;

    private SurfaceView oppervlak;
    private Beeldvlak beeldvlak;
    private TextView uitleg;
    private Camera camera;
    private boolean klaar;
    private long laatstePoging;
    /** De maat van het camerabeeld; hier bewaard zodat er per beeld geen navraag nodig is. */
    private int beeldBreedte;
    private int beeldHoogte;
    /**
     * Is het cameravlak er al? Bij het openen van dit scherm is dat nog niet zo: onResume
     * loopt vóór surfaceCreated. Wie het beeld dan alvast aanzet, zet het aan zonder vlak —
     * en dan blijft het scherm zwart, ook als de camera zelf gewoon open is.
     */
    private boolean oppervlakKlaar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(bouwScherm());
        setResult(RESULT_CANCELED);

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.i(TAG, "SJPEELAVOND_SCANNER toestemming vragen");
            requestPermissions(new String[] { Manifest.permission.CAMERA }, PERMISSIE_CAMERA);
        }
    }

    private FrameLayout bouwScherm() {
        FrameLayout houder = new FrameLayout(this);
        houder.setBackgroundColor(Color.BLACK);

        // Het camerabeeld zit in een eigen vlak dat de verhouding van de camera aanhoudt.
        // Zonder dat wordt een breed beeld (bijvoorbeeld 1280 bij 720) uitgerekt over het
        // hele rechtopstaande scherm en klopt de verhouding niet meer.
        beeldvlak = new Beeldvlak(this);
        oppervlak = new SurfaceView(this);
        oppervlak.getHolder().addCallback(this);
        beeldvlak.addView(oppervlak, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams beeldMaat = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        beeldMaat.gravity = Gravity.CENTER;
        houder.addView(beeldvlak, beeldMaat);

        LinearLayout tekstvak = new LinearLayout(this);
        tekstvak.setOrientation(LinearLayout.VERTICAL);
        tekstvak.setGravity(Gravity.CENTER);
        tekstvak.setPadding(48, 48, 48, 48);

        uitleg = new TextView(this);
        uitleg.setText("Houd de QR-code van het kaartje in het beeld.");
        uitleg.setTextColor(Color.WHITE);
        uitleg.setTextSize(16f);
        uitleg.setGravity(Gravity.CENTER);
        tekstvak.addView(uitleg);

        Button stoppen = new Button(this);
        stoppen.setText("Terug");
        stoppen.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams knop = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knop.topMargin = 24;
        knop.gravity = Gravity.CENTER_HORIZONTAL;
        tekstvak.addView(stoppen, knop);

        FrameLayout.LayoutParams onder = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        onder.gravity = Gravity.BOTTOM;
        houder.addView(tekstvak, onder);
        return houder;
    }

    @Override
    public void onRequestPermissionsResult(int verzoek, String[] rechten, int[] uitslagen) {
        if (verzoek != PERMISSIE_CAMERA) return;
        if (uitslagen.length > 0 && uitslagen[0] == PackageManager.PERMISSION_GRANTED) {
            openCamera();
        } else {
            meld("Zonder cameratoegang kan de app geen kaartje scannen. Zet dat aan bij Instellingen → Apps → Sjpeelavond → Toestemmingen → Camera.");
        }
    }

    private void meld(String bericht) {
        Log.i(TAG, "SJPEELAVOND_SCANNER " + bericht);
        if (uitleg != null) uitleg.setText(bericht);
    }

    /* ── camera ──────────────────────────────────────────────────────────── */

    private void openCamera() {
        if (camera != null || isFinishing()) return;
        try {
            camera = Camera.open();
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER camera openen mislukt: " + fout.getMessage());
            meld("De app kon de camera niet openen. Controleer of de app cameratoegang heeft.");
            return;
        }
        if (camera == null) {
            meld("Dit toestel heeft geen camera die de app kan gebruiken.");
            return;
        }
        // De instellingen van de camera worden op sommige toestellen geweigerd. Dat mag de app
        // niet laten afsluiten: dan gaat het zonder eigen instellingen verder en melden we het.
        Camera.Size maat = null;
        try {
            Camera.Parameters instellingen = camera.getParameters();
            maat = kiesMaat(instellingen.getSupportedPreviewSizes());
            if (maat != null) instellingen.setPreviewSize(maat.width, maat.height);
            instellingen.setPreviewFormat(ImageFormat.NV21);
            // Scherpstellen: zonder dit blijft het beeld wazig en leest de app de code niet.
            List<String> scherpstellen = instellingen.getSupportedFocusModes();
            if (scherpstellen != null && scherpstellen.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                instellingen.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (scherpstellen != null && scherpstellen.contains(Camera.Parameters.FOCUS_MODE_AUTO)) {
                instellingen.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            }
            camera.setParameters(instellingen);
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER instellingen geweigerd: " + fout.getMessage());
            maat = null;
            try {
                camera.setParameters(camera.getParameters());
            } catch (Exception nog) {
                Log.i(TAG, "SJPEELAVOND_SCANNER ook de standaardinstellingen niet: " + nog.getMessage());
            }
        }
        if (maat == null) {
            try {
                maat = camera.getParameters().getPreviewSize();
            } catch (Exception fout) {
                maat = null;
            }
        }
        beeldBreedte = maat == null ? 0 : maat.width;
        beeldHoogte = maat == null ? 0 : maat.height;
        // Het beeld rechtop zetten en het vlak de juiste verhouding geven: het scherm staat
        // rechtop, het camerabeeld komt breed binnen.
        try {
            camera.setDisplayOrientation(beeldstand());
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER beeldstand niet te zetten: " + fout.getMessage());
        }
        if (beeldvlak != null && beeldBreedte > 0 && beeldHoogte > 0) {
            // Gedraaid komt het beeld als hoogte bij breedte op het scherm.
            beeldvlak.zetVerhouding((double) beeldBreedte / beeldHoogte);
        }
        if (oppervlakKlaar) {
            hangBeeldAan();
        } else {
            // Nog geen vlak: de camera staat klaar, het beeld volgt zodra het vlak er is
            // (surfaceCreated of surfaceChanged roept hangBeeldAan aan).
            Log.i(TAG, "SJPEELAVOND_SCANNER camera open, wacht op het beeldvlak");
        }
    }

    /**
     * Het camerabeeld aan het vlak hangen en aanzetten. Mag vaker gebeuren: het vlak kan
     * opnieuw gemaakt worden (bijvoorbeeld na het toestemmingsvenster of bij het draaien),
     * en zonder deze stap bleef het scherm zwart terwijl de camera allang open was.
     */
    private void hangBeeldAan() {
        if (camera == null || !oppervlakKlaar || isFinishing()) return;
        try {
            camera.stopPreview();
        } catch (Exception fout) {
            // Liep nog niet; geen probleem.
        }
        try {
            camera.setPreviewDisplay(oppervlak.getHolder());
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER geen beeldvlak: " + fout.getMessage());
            meld("De camera kon het beeld niet op het scherm zetten.");
            return;
        }
        try {
            camera.setPreviewCallback(this);
            camera.startPreview();
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER starten mislukt: " + fout.getMessage());
            meld("De camera kon niet starten op dit toestel.");
            return;
        }
        Log.i(TAG, "SJPEELAVOND_SCANNER beeld aan het vlak " + beeldBreedte + "x" + beeldHoogte);
    }

    /**
     * De maat die het beste leest.
     *
     * Een code die klein in beeld staat (een kaartje dat verder weg gehouden wordt) heeft
     * meer beeldpunten per blokje nodig, dus liever een grotere maat dan 1280 breed — maar
     * niet groter dan nodig, want elk beeld moet ook gelezen worden. Een maat van 4:3 past
     * bovendien beter bij een rechtopstaand scherm dan een breedbeeldmaat.
     */
    private Camera.Size kiesMaat(List<Camera.Size> maten) {
        if (maten == null || maten.isEmpty()) return null;
        Camera.Size groot = null;
        for (Camera.Size maat : maten) {
            if (maat.width > GEWENSTE_BREEDTE_MAX || maat.height <= 0) continue;
            double verhouding = (double) maat.width / maat.height;
            if (verhouding < 1.2) continue; // geen 4:3 of breder: past niet bij een rechtopstaand scherm
            if (groot == null || maat.width > groot.width) groot = maat;
        }
        if (groot != null) return groot;

        // Geen 4:3-maat: dan de maat die het dichtst bij 1280 breed zit.
        Camera.Size beste = maten.get(0);
        for (Camera.Size maat : maten) {
            if (Math.abs(maat.width - GEWENSTE_BREEDTE) < Math.abs(beste.width - GEWENSTE_BREEDTE)) beste = maat;
        }
        return beste;
    }

    /**
     * Hoeveel graden het camerabeeld gedraaid moet worden om rechtop te staan. Dit is de
     * standaardberekening van Android: de stand van de camera plus die van het scherm.
     */
    private int beeldstand() {
        Camera.CameraInfo gegevens = new Camera.CameraInfo();
        try {
            Camera.getCameraInfo(0, gegevens);
        } catch (Exception fout) {
            return 90; // geen gegevens: rechtop is de gebruikelijke stand
        }
        int schermstand = 0;
        try {
            switch (getWindowManager().getDefaultDisplay().getRotation()) {
                case Surface.ROTATION_90:
                    schermstand = 90;
                    break;
                case Surface.ROTATION_180:
                    schermstand = 180;
                    break;
                case Surface.ROTATION_270:
                    schermstand = 270;
                    break;
                default:
                    schermstand = 0;
            }
        } catch (Exception fout) {
            schermstand = 0;
        }
        if (gegevens.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            return (gegevens.orientation + schermstand) % 360;
        }
        return (gegevens.orientation - schermstand + 360) % 360;
    }

    /**
     * Een vlak dat de verhouding van het camerabeeld aanhoudt, zodat het beeld niet wordt
     * uitgerekt. Het beeldvlak krijgt de volle breedte en de hoogte die daarbij hoort; de
     * rest van het scherm blijft zwart.
     */
    private static class Beeldvlak extends FrameLayout {

        private double verhouding = 16.0 / 9.0; // hoogte gedeeld door breedte
        Beeldvlak(Context context) {
            super(context);
        }

        void zetVerhouding(double nieuwe) {
            if (nieuwe <= 0 || Math.abs(nieuwe - verhouding) < 0.001) return;
            verhouding = nieuwe;
            requestLayout();
        }

        @Override
        protected void onMeasure(int breedteMaat, int hoogteMaat) {
            int breedte = MeasureSpec.getSize(breedteMaat);
            int hoogte = MeasureSpec.getSize(hoogteMaat);
            int gewenst = breedte > 0 ? (int) Math.round(breedte * verhouding) : 0;
            if (gewenst > 0 && (hoogte <= 0 || gewenst <= hoogte)) {
                setMeasuredDimension(breedte, gewenst);
                measureChildren(MeasureSpec.makeMeasureSpec(breedte, MeasureSpec.EXACTLY),
                        MeasureSpec.makeMeasureSpec(gewenst, MeasureSpec.EXACTLY));
                return;
            }
            super.onMeasure(breedteMaat, hoogteMaat);
        }
    }

    private void sluitCamera() {
        if (camera == null) return;
        try {
            camera.setPreviewCallback(null);
            camera.stopPreview();
            camera.release();
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER camera sluiten: " + fout.getMessage());
        }
        camera = null;
    }

    @Override
    public void surfaceCreated(SurfaceHolder houder) {
        oppervlakKlaar = true;
        if (camera == null) openCamera();
        else hangBeeldAan();
    }

    @Override
    public void surfaceChanged(SurfaceHolder houder, int formaat, int breedte, int hoogte) {
        oppervlakKlaar = true;
        if (camera == null) openCamera();
        else hangBeeldAan();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder houder) {
        oppervlakKlaar = false;
        sluitCamera();
    }

    /* ── lezen ───────────────────────────────────────────────────────────── */

    @Override
    public void onPreviewFrame(byte[] beeld, Camera camera) {
        if (klaar || beeld == null) return;
        long nu = System.currentTimeMillis();
        if (nu - laatstePoging < MIN_TIJD_TUSSEN_POGINGEN_MS) return;
        laatstePoging = nu;

        if (beeldBreedte <= 0 || beeldHoogte <= 0) return;
        String tekst = QrLezer.lees(beeld, beeldBreedte, beeldHoogte);
        if (tekst == null) return;

        klaar = true;
        Log.i(TAG, "SJPEELAVOND_SCANNER gelezen");
        Intent uitkomst = new Intent();
        uitkomst.putExtra(EXTRA_CODE, tekst);
        setResult(RESULT_OK, uitkomst);
        finish();
    }


    @Override
    protected void onPause() {
        super.onPause();
        sluitCamera();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Alleen openen als het vlak er al is; anders blijft het beeld zwart (zie
        // oppervlakKlaar). Is het vlak er nog niet, dan doet surfaceCreated het.
        if (oppervlakKlaar && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            openCamera();
        }
    }

    @Override
    protected void onDestroy() {
        sluitCamera();
        super.onDestroy();
    }
}
