package nl.werdens.sjpeelavond;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
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
    private static final long MIN_TIJD_TUSSEN_POGINGEN_MS = 250;

    private SurfaceView oppervlak;
    private TextView uitleg;
    private Camera camera;
    private boolean klaar;
    private long laatstePoging;
    /** De maat van het camerabeeld; hier bewaard zodat er per beeld geen navraag nodig is. */
    private int beeldBreedte;
    private int beeldHoogte;

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

        oppervlak = new SurfaceView(this);
        oppervlak.getHolder().addCallback(this);
        houder.addView(oppervlak, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

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
        try {
            camera.setPreviewDisplay(oppervlak.getHolder());
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER geen beeld: " + fout.getMessage());
        }
        try {
            camera.setPreviewCallback(this);
            camera.startPreview();
        } catch (Exception fout) {
            Log.i(TAG, "SJPEELAVOND_SCANNER starten mislukt: " + fout.getMessage());
            meld("De camera kon niet starten op dit toestel.");
            return;
        }
        Log.i(TAG, "SJPEELAVOND_SCANNER camera open " + (maat == null ? "" : maat.width + "x" + maat.height));
    }

    /** De maat die het dichtst bij 1280 breed zit; te klein leest geen code. */
    private Camera.Size kiesMaat(List<Camera.Size> maten) {
        if (maten == null || maten.isEmpty()) return null;
        Camera.Size beste = maten.get(0);
        for (Camera.Size maat : maten) {
            if (Math.abs(maat.width - GEWENSTE_BREEDTE) < Math.abs(beste.width - GEWENSTE_BREEDTE)) beste = maat;
        }
        return beste;
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
        openCamera();
    }

    @Override
    public void surfaceChanged(SurfaceHolder houder, int formaat, int breedte, int hoogte) {
        openCamera();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder houder) {
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
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) openCamera();
    }

    @Override
    protected void onDestroy() {
        sluitCamera();
        super.onDestroy();
    }
}
