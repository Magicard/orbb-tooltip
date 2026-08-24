#include <iostream>
#include <vector>
#include <stdexcept>
#include <fstream>
#include <memory>
#include <cstring>
#include <tesseract/baseapi.h>
#include <tesseract/ocrclass.h>
#include <leptonica/allheaders.h>
#include <chrono>
#include <windows.h>
#include <shellscalingapi.h>
#pragma comment(lib, "Shcore.lib")
#include <thread>
#include <stdio.h>
#include <algorithm>
#include <regex>
#include <string>
#include <atomic>
#include <mutex>
#include <nlohmann/json.hpp>

using namespace std;
using json = nlohmann::json;

// Configurable border color (can be overridden via command line arguments)
static short borderColorRed = 82;
static short borderColorGreen = 89;
static short borderColorBlue = 90;

// Pre-compiled regex patterns for performance
static const std::regex regexNewlineCRLF("\r\n");
static const std::regex regexNewlineLF("\n");
static const std::regex regexAtSymbol("@");

// Cached desktop DC (optimization #2)
static HDC cachedDesktopDC = NULL;
static HWND cachedDesktopWindow = NULL;

// Pixel buffer cache for batch reading (optimization #1)
struct PixelBuffer {
	vector<uint8_t> pixels;
	int x, y, width, height;
	int bytesPerPixel;
	int bytesPerScanLine;
	
	PixelBuffer() : x(0), y(0), width(0), height(0), bytesPerPixel(4), bytesPerScanLine(0) {}
};

static PixelBuffer cachedPixelBuffer;

class Image
{
private:
	vector<uint8_t> Pixels;
	uint32_t width, height;
	uint16_t BitsPerPixel;

	void Flip(void* In, void* Out, int width, int height, unsigned int Bpp);

public:
	explicit Image(HDC DC, int X, int Y, int Width, int Height);

	inline uint16_t GetBitsPerPixel() { return this->BitsPerPixel; }
	inline uint16_t GetBytesPerPixel() { return this->BitsPerPixel / 8; }
	inline uint16_t GetBytesPerScanLine() { return (this->BitsPerPixel / 8) * this->width; }
	inline int GetWidth() const { return this->width; }
	inline int GetHeight() const { return this->height; }
	inline const uint8_t* GetPixels() { return this->Pixels.data(); }
};

void Image::Flip(void* In, void* Out, int width, int height, unsigned int Bpp)
{
	unsigned long Chunk = (Bpp > 24 ? width * 4 : width * 3 + width % 4);
	unsigned char* Destination = static_cast<unsigned char*>(Out);
	unsigned char* Source = static_cast<unsigned char*>(In) + Chunk * (height - 1);

	while (Source != In)
	{
		memcpy(Destination, Source, Chunk);
		Destination += Chunk;
		Source -= Chunk;
	}
}

Image::Image(HDC DC, int X, int Y, int Width, int Height) : Pixels(), width(Width), height(Height), BitsPerPixel(32)
{
	BITMAP Bmp = { 0 };
	HBITMAP hBmp = reinterpret_cast<HBITMAP>(GetCurrentObject(DC, OBJ_BITMAP));

	if (GetObject(hBmp, sizeof(BITMAP), &Bmp) == 0)
		throw runtime_error("BITMAP DC NOT FOUND.");

	RECT area = { X, Y, X + Width, Y + Height };
	HWND Window = WindowFromDC(DC);
	GetClientRect(Window, &area);

	HDC MemDC = GetDC(nullptr);
	HDC SDC = CreateCompatibleDC(MemDC);
	HBITMAP hSBmp = CreateCompatibleBitmap(MemDC, width, height);
	DeleteObject(SelectObject(SDC, hSBmp));

	BitBlt(SDC, 0, 0, width, height, DC, X, Y, SRCCOPY);
	unsigned int data_size = ((width * BitsPerPixel + 31) / 32) * 4 * height;
	vector<uint8_t> Data(data_size);
	this->Pixels.resize(data_size);

	BITMAPINFO Info = { sizeof(BITMAPINFOHEADER), static_cast<long>(width), static_cast<long>(height), 1, BitsPerPixel, BI_RGB, data_size, 0, 0, 0, 0 };
	GetDIBits(SDC, hSBmp, 0, height, &Data[0], &Info, DIB_RGB_COLORS);
	this->Flip(&Data[0], &Pixels[0], width, height, BitsPerPixel);

	DeleteDC(SDC);
	DeleteObject(hSBmp);
	ReleaseDC(nullptr, MemDC);
}

static bool pixelIsBorderColor(short& red, short& green, short& blue) {
	if (red == borderColorRed && green == borderColorGreen && blue == borderColorBlue) {
		return true;
	}

	return false;
}

// Capture a pixel region to buffer for fast access (optimization #1)
static bool capturePixelRegion(HDC dc, int x, int y, int width, int height, bool forceRecapture = false) {
	// Check if we need to recapture (only skip if same region and not forced)
	if (!forceRecapture && cachedPixelBuffer.x == x && cachedPixelBuffer.y == y && 
		cachedPixelBuffer.width == width && cachedPixelBuffer.height == height &&
		!cachedPixelBuffer.pixels.empty()) {
		return true; // Already have this region cached
	}

	cachedPixelBuffer.x = x;
	cachedPixelBuffer.y = y;
	cachedPixelBuffer.width = width;
	cachedPixelBuffer.height = height;
	cachedPixelBuffer.bytesPerPixel = 4; // 32-bit RGB
	cachedPixelBuffer.bytesPerScanLine = ((width * 32 + 31) / 32) * 4;

	unsigned int data_size = cachedPixelBuffer.bytesPerScanLine * height;
	cachedPixelBuffer.pixels.resize(data_size);

	HDC MemDC = GetDC(nullptr);
	if (MemDC == NULL) {
		cerr << "ERROR: Failed to get memory device context" << endl;
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	HDC SDC = CreateCompatibleDC(MemDC);
	if (SDC == NULL) {
		cerr << "ERROR: Failed to create compatible DC" << endl;
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	HBITMAP hSBmp = CreateCompatibleBitmap(MemDC, width, height);
	if (hSBmp == NULL) {
		cerr << "ERROR: Failed to create compatible bitmap" << endl;
		DeleteDC(SDC);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	DeleteObject(SelectObject(SDC, hSBmp));

	if (!BitBlt(SDC, 0, 0, width, height, dc, x, y, SRCCOPY)) {
		cerr << "ERROR: BitBlt failed during pixel capture" << endl;
		DeleteDC(SDC);
		DeleteObject(hSBmp);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	BITMAPINFO Info = { sizeof(BITMAPINFOHEADER), static_cast<long>(width), static_cast<long>(height), 1, 32, BI_RGB, data_size, 0, 0, 0, 0 };
	if (GetDIBits(SDC, hSBmp, 0, height, cachedPixelBuffer.pixels.data(), &Info, DIB_RGB_COLORS) == 0) {
		cerr << "ERROR: GetDIBits failed during pixel capture" << endl;
		DeleteDC(SDC);
		DeleteObject(hSBmp);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	// Flip the image (Windows bitmaps are bottom-up)
	unsigned long Chunk = cachedPixelBuffer.bytesPerScanLine;
	vector<uint8_t> flipped(data_size);
	unsigned char* Destination = flipped.data();
	unsigned char* Source = cachedPixelBuffer.pixels.data() + Chunk * (height - 1);

	while (Source >= cachedPixelBuffer.pixels.data()) {
		memcpy(Destination, Source, Chunk);
		Destination += Chunk;
		Source -= Chunk;
	}
	cachedPixelBuffer.pixels = std::move(flipped);

	DeleteDC(SDC);
	DeleteObject(hSBmp);
	ReleaseDC(nullptr, MemDC);
	return true;
}

// Read pixel from cached buffer (optimization #1)
static bool getPixelFromBuffer(int x, int y, short& red, short& green, short& blue) {
	// Check if pixel is within cached region
	int relX = x - cachedPixelBuffer.x;
	int relY = y - cachedPixelBuffer.y;

	if (relX < 0 || relY < 0 || relX >= cachedPixelBuffer.width || relY >= cachedPixelBuffer.height) {
		return false; // Pixel not in cached region
	}

	// Calculate offset in buffer (BGRA format, bottom-up was flipped to top-down)
	int offset = (relY * cachedPixelBuffer.bytesPerScanLine) + (relX * cachedPixelBuffer.bytesPerPixel);
	
	if (offset + 2 >= static_cast<int>(cachedPixelBuffer.pixels.size())) {
		return false;
	}

	// Windows DIB is BGRA format
	blue = cachedPixelBuffer.pixels[offset];
	green = cachedPixelBuffer.pixels[offset + 1];
	red = cachedPixelBuffer.pixels[offset + 2];

	return true;
}

static bool pixelIsValid(short startingX, short startingY, short& red, short& green, short& blue, short offsetX = 0, short offsetY = 0) {
	LONG x = startingX + offsetX;
	LONG y = startingY + offsetY;

	// Try to read from cached buffer first
	if (getPixelFromBuffer(x, y, red, green, blue)) {
		return pixelIsBorderColor(red, green, blue);
	}

	// Fallback to GetPixel if not in cache (shouldn't happen with proper caching)
	if (cachedDesktopDC) {
		COLORREF color = GetPixel(cachedDesktopDC, x, y);
		if (color == CLR_INVALID) {
			// GetPixel failed - could be due to hardware acceleration or other issues
			return false;
		}
		red = GetRValue(color);
		green = GetGValue(color);
		blue = GetBValue(color);
		return pixelIsBorderColor(red, green, blue);
	}

	return false;
}

static void getBottomRightBorderPoint(short startingX, short startingY, short& red, short& green, short& blue, short& offsetX, short checkRange) {
	offsetX += checkRange;

	while (pixelIsValid(startingX, startingY, red, green, blue, offsetX)) {
		offsetX += checkRange;
	}

	offsetX -= checkRange;
}

static void getTopLeftBorderPoint(short startingX, short startingY, short& red, short& green, short& blue, short& offsetY, short checkRange) {
	offsetY += checkRange;

	while (pixelIsValid(startingX, startingY, red, green, blue, 0, offsetY)) {
		offsetY += checkRange;
	}

	offsetY -= checkRange;
}

static std::string scanForText(tesseract::TessBaseAPI& tess, int x1, int y1, int width, int height) {
	std::string result;

	if (!cachedDesktopDC) {
		return result;
	}

	// Capture the image
	Image img(cachedDesktopDC, x1, y1, width, height);

	tess.SetImage(img.GetPixels(), img.GetWidth(), img.GetHeight(),
		img.GetBytesPerPixel(), img.GetBytesPerScanLine());

	char* utf8 = tess.GetUTF8Text();
	if (utf8) {
		result.assign(utf8);
		delete[] utf8;
	}

	return result;
}

// ---- Ctrl+wheel hook -------------------------------------------------------
// A low-level mouse hook on its own thread (with its own message loop, so it
// is never delayed by OCR work). While enabled, Ctrl+wheel is reported to the
// main process as "WHEEL||<delta>" and swallowed so the game ignores it; the
// quest panel uses it to scroll while the game owns the cursor.
static std::atomic<bool> g_wheelHookEnabled{ false };
static std::mutex g_stdoutMutex;
// Ctrl+wheel delta the hook has taken but not reported yet
static std::atomic<int> g_wheelPending{ 0 };
static HANDLE g_wheelEvent = NULL;
static HHOOK g_wheelHook = NULL;

static LRESULT CALLBACK WheelHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
	if (nCode >= 0 && wParam == WM_MOUSEWHEEL && g_wheelHookEnabled.load(std::memory_order_relaxed)
		&& (GetAsyncKeyState(VK_CONTROL) & 0x8000)) {
		const MSLLHOOKSTRUCT* info = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
		// Never block in here: Windows silently drops a low-level hook that
		// is ever slow to answer. Hand the delta to the reporter and return.
		g_wheelPending.fetch_add((short)HIWORD(info->mouseData));
		if (g_wheelEvent) SetEvent(g_wheelEvent);
		return 1; // swallowed
	}
	return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Writes the accumulated Ctrl+wheel delta to stdout, off the hook thread
static void WheelReportThread() {
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
	while (true) {
		WaitForSingleObject(g_wheelEvent, INFINITE);
		int delta = g_wheelPending.exchange(0);
		if (delta == 0) continue;
		std::lock_guard<std::mutex> lock(g_stdoutMutex);
		cout << "WHEEL||" << delta << endl;
		fflush(stdout);
	}
}

static void InstallWheelHook() {
	if (g_wheelHook) UnhookWindowsHookEx(g_wheelHook);
	g_wheelHook = SetWindowsHookExW(WH_MOUSE_LL, WheelHookProc, GetModuleHandleW(NULL), 0);
}

static void WheelHookThread() {
	// Above the game's threads even though this process runs below normal,
	// so the hook is always serviced inside Windows' low-level hook timeout
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
	g_wheelEvent = CreateEventW(NULL, FALSE, FALSE, NULL);
	std::thread(WheelReportThread).detach();
	InstallWheelHook();
	if (!g_wheelHook) return;
	// Windows removes a low-level hook it ever considered slow and never
	// says so; re-installing every few seconds while enabled bounds any
	// such outage to a few seconds instead of the rest of the session
	SetTimer(NULL, 0, 4000, NULL);
	MSG msg;
	while (GetMessageW(&msg, NULL, 0, 0) > 0) {
		if (msg.message == WM_TIMER) {
			if (g_wheelHookEnabled.load()) InstallWheelHook();
			continue;
		}
		TranslateMessage(&msg);
		DispatchMessageW(&msg);
	}
	if (g_wheelHook) UnhookWindowsHookEx(g_wheelHook);
}

// Non-blocking check for a command line on stdin (the Electron main process
// writes e.g. "SCAN\n" to request an on-demand full-screen OCR)
static bool readStdinLine(std::string& line) {
	static std::string pending;
	HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
	if (in == INVALID_HANDLE_VALUE || in == NULL) return false;

	DWORD available = 0;
	if (!PeekNamedPipe(in, NULL, 0, NULL, &available, NULL) || available == 0) {
		return false;
	}
	char buffer[512];
	DWORD read = 0;
	while (available > 0) {
		DWORD toRead = available < sizeof(buffer) ? available : (DWORD)sizeof(buffer);
		if (!ReadFile(in, buffer, toRead, &read, NULL) || read == 0) break;
		pending.append(buffer, read);
		available -= read;
	}
	size_t eol = pending.find('\n');
	if (eol == std::string::npos) return false;
	line = pending.substr(0, eol);
	pending.erase(0, eol + 1);
	while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
	return true;
}

// Page-style OCR of a Leptonica image (optionally upscaled first - small
// UI text such as the in-raid notification toasts needs ~2x to be legible
// to Tesseract). Tooltip-tuned settings are restored afterwards.
// deadlineMs > 0 bounds the recognition time (the page is a best effort of
// whatever was read before the deadline) so a busy scene can never stall the
// helper and the tooltip scans queued behind it
static std::string ocrPage(tesseract::TessBaseAPI& tess, PIX* source, float scale, int deadlineMs = 0) {
	std::string result;
	if (!source) return result;

	PIX* work = source;
	if (scale > 1.01f) {
		work = pixScale(source, scale, scale);
		if (!work) work = source;
	}

	tess.SetPageSegMode(tesseract::PSM_SPARSE_TEXT);
	tess.SetVariable("tessedit_char_whitelist", "");
	tess.SetVariable("classify_bln_numeric_mode", "0");
	tess.SetVariable("preserve_interword_spaces", "1");
	tess.SetImage(work);
	if (scale > 1.01f) {
		// Report the scaled resolution so word boxes stay in screen pixels
		tess.SetSourceResolution((int)(70 * scale));
	}

	if (deadlineMs > 0) {
		tesseract::ETEXT_DESC monitor;
		monitor.set_deadline_msecs(deadlineMs);
		if (tess.Recognize(&monitor) != 0) {
			std::cerr << "OCR deadline of " << deadlineMs << "ms hit on a " << pixGetWidth(work) << "x" << pixGetHeight(work) << " page" << std::endl;
		}
	}

	// TSV (one word per line with its bounding box) so the caller can rebuild
	// table rows from word positions regardless of how the page segmented
	char* tsv = tess.GetTSVText(0);
	if (tsv) {
		result.assign(tsv);
		delete[] tsv;
	}

	if (work != source) pixDestroy(&work);

	// Back to the fast tooltip configuration
	tess.SetPageSegMode(tesseract::PSM_SINGLE_BLOCK);
	tess.SetVariable("tessedit_char_whitelist", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,$€₽@- ");
	tess.SetVariable("classify_bln_numeric_mode", "1");
	tess.SetVariable("preserve_interword_spaces", "0");
	return result;
}

// Build a Leptonica PIX from a captured BGRA screen image
static PIX* pixFromImage(Image& img) {
	PIX* pix = pixCreate(img.GetWidth(), img.GetHeight(), 32);
	if (!pix) return nullptr;
	const uint8_t* src = img.GetPixels();
	int stride = img.GetBytesPerScanLine();
	l_uint32* data = pixGetData(pix);
	int wpl = pixGetWpl(pix);
	for (int y = 0; y < img.GetHeight(); y++) {
		const uint8_t* row = src + y * stride;
		l_uint32* line = data + y * wpl;
		for (int x = 0; x < img.GetWidth(); x++) {
			const uint8_t* px = row + x * 4; // BGRA
			composeRGBPixel(px[2], px[1], px[0], &line[x]);
		}
	}
	return pix;
}

struct ScreenRect { int x, y, w, h; };

// Luminance below which a pixel is not "toast text". Notification text is
// white / light grey on a dark translucent panel, so keeping only the bright
// pixels leaves Tesseract an almost empty page for ordinary scenery.
static const int TOAST_BRIGHT_THRESHOLD = 140;
// Fewer bright pixels than this and there is no text worth recognising
static const int TOAST_MIN_BRIGHT_PIXELS = 300;
static const int TOAST_OCR_DEADLINE_MS = 2000;
static const int PAGE_OCR_DEADLINE_MS = 10000;

// Colour of the cyan tick the Tasks screen draws after a completed objective
static bool isTickColour(l_uint32 px) {
	l_int32 r = 0, g = 0, b = 0;
	extractRGBValues(px, &r, &g, &b);
	return r < 160 && g > 120 && b > 120 && (g - r) > 40 && (b - r) > 40;
}

// The Tasks screen paints the band behind a completed objective a dark blue,
// while an unfinished one stays neutral grey. That band is thousands of
// pixels against the tick's few hundred, so it is the sturdier signal.
static bool isDoneRowColour(l_uint32 px) {
	l_int32 r = 0, g = 0, b = 0;
	extractRGBValues(px, &r, &g, &b);
	return b > 28 && b < 150 && (b - r) > 12 && (g - r) >= 0 && r < 110;
}

// Append to every word line of a TSV page two columns: the number of
// tick-coloured pixels in and just right of the word's box, and the
// percentage of the row band behind the word painted the "objective done"
// blue. Together they tell a completed objective row from a pending one.
// Other lines pass through unchanged.
static std::string annotateTicks(const std::string& tsv, PIX* pix) {
	if (!pix || pixGetDepth(pix) != 32) return tsv;
	const l_int32 w = pixGetWidth(pix), h = pixGetHeight(pix);
	const l_uint32* data = pixGetData(pix);
	const l_int32 wpl = pixGetWpl(pix);
	std::string out;
	out.reserve(tsv.size() + 2048);
	size_t start = 0;
	while (start < tsv.size()) {
		size_t end = tsv.find('\n', start);
		const bool last = end == std::string::npos;
		if (last) end = tsv.size();
		std::string line = tsv.substr(start, end - start);
		if (!line.empty() && line.back() == '\r') line.pop_back();
		if (line.rfind("5\t", 0) == 0) {
			// level page block para line word left top width height conf text
			int cols[10] = { 0 };
			size_t pos = 0;
			bool ok = true;
			for (int i = 0; i < 10 && ok; i++) {
				size_t tab = line.find('\t', pos);
				if (tab == std::string::npos) { ok = false; break; }
				cols[i] = atoi(line.substr(pos, tab - pos).c_str());
				pos = tab + 1;
			}
			if (ok) {
				// From the word's own box (the tick may have been read as a word
				// itself) to well past its right edge
				const int x0 = (std::max)(0, cols[6] - 2), x1 = (std::min)(w, cols[6] + cols[8] + 60);
				const int y0 = (std::max)(0, cols[7] - 2), y1 = (std::min)(h, cols[7] + cols[9] + 2);
				int ticks = 0;
				for (int y = y0; y < y1; y++) {
					const l_uint32* row = data + (size_t)y * wpl;
					for (int x = (std::max)(0, x0); x < x1; x++) {
						if (isTickColour(row[x])) ticks++;
					}
				}
				// Background just above and below the glyphs, where no text
				// can interfere: what colour is this row's band?
				int blue = 0, band = 0;
				for (const int y : { cols[7] - 5, cols[7] - 4, cols[7] + cols[9] + 3, cols[7] + cols[9] + 4 }) {
					if (y < 0 || y >= h) continue;
					const l_uint32* row = data + (size_t)y * wpl;
					for (int x = (std::max)(0, cols[6]); x < (std::min)(w, cols[6] + cols[8]); x++) {
						band++;
						if (isDoneRowColour(row[x])) blue++;
					}
				}
				line += "\t" + std::to_string(ticks);
				line += "\t" + std::to_string(band > 0 ? (blue * 100) / band : 0);
			}
		}
		out += line;
		out += '\n';
		start = last ? tsv.size() : end + 1;
	}
	return out;
}

// ---- constrained counter re-read -------------------------------------------
// An objective's "1/5" counter is drawn on top of its progress bar, and the
// sparse page pass reads the bar's edge as part of the glyphs - "1/5" comes
// back as "Ml v5". The garbled words still carry correct boxes, so the fix
// is a second, narrow look: crop exactly that region, keep only its bright
// pixels (the digits are white, the bar is not - the same trick the toast
// pipeline uses), scale it up, and let Tesseract read it knowing only digits
// and a slash exist. The reading is appended as a 15th column to every word
// of the garbled tail, so the consumer can both use it and know how many
// words it replaces. Only readings that verify as "<n>/<n>" are kept.

static const int COUNTER_RESCAN_LIMIT = 12;
static const float COUNTER_RESCAN_SCALE = 3.0f;

// Characters the page pass produces when it misreads a counter
static bool counterSuspect(const std::string& joined) {
	if (joined.size() < 2 || joined.size() > 9) return false;
	bool digitish = false, slashish = false;
	for (char c : joined) {
		if (!strchr("0123456789lIiOoSsMmWw|!/vVyY", c)) return false;
		if (strchr("0123456789lIOoSs", c)) digitish = true;
		if (strchr("/vVyY|!", c)) slashish = true;
	}
	return digitish && slashish;
}

static bool cleanCounter(const std::string& t) {
	size_t slash = t.find('/');
	if (slash == std::string::npos || slash == 0 || slash + 1 >= t.size() || t.size() > 9) return false;
	for (size_t i = 0; i < t.size(); i++) {
		if (i == slash) continue;
		if (!isdigit((unsigned char)t[i])) return false;
	}
	// The shape alone is not enough: a phantom digit turns 1/5 into a
	// plausible 11/5. A counter never exceeds its total.
	const int count = atoi(t.substr(0, slash).c_str());
	const int total = atoi(t.substr(slash + 1).c_str());
	return total > 0 && count <= total;
}

static std::string constrainCounters(tesseract::TessBaseAPI& tess, const std::string& tsv, PIX* pix) {
	if (!pix || pixGetDepth(pix) != 32) return tsv;

	struct Row { std::string raw; bool word = false; int x = 0, y = 0, w = 0, h = 0; std::string text; };
	std::vector<Row> rows;
	size_t start = 0;
	while (start < tsv.size()) {
		size_t end = tsv.find('\n', start);
		const bool last = end == std::string::npos;
		if (last) end = tsv.size();
		Row row;
		row.raw = tsv.substr(start, end - start);
		if (!row.raw.empty() && row.raw.back() == '\r') row.raw.pop_back();
		if (row.raw.rfind("5\t", 0) == 0) {
			std::vector<std::string> cols;
			size_t pos = 0;
			while (pos <= row.raw.size()) {
				size_t tab = row.raw.find('\t', pos);
				if (tab == std::string::npos) { cols.push_back(row.raw.substr(pos)); break; }
				cols.push_back(row.raw.substr(pos, tab - pos));
				pos = tab + 1;
			}
			if (cols.size() >= 12) {
				row.word = true;
				row.x = atoi(cols[6].c_str()); row.y = atoi(cols[7].c_str());
				row.w = atoi(cols[8].c_str()); row.h = atoi(cols[9].c_str());
				row.text = cols[11];
			}
		}
		rows.push_back(std::move(row));
		if (last) break;
		start = end + 1;
	}

	// Visual lines, not Tesseract lines: the sparse page mode gives every
	// text blob its own block, so a counter shattered into "Ml" and "v5"
	// never shares block/para/line numbers. Words share a line when their
	// vertical centres sit within about a glyph height; a horizontal gap
	// wider than a few characters starts a new cell, and a counter is the
	// last thing in its cell.
	std::vector<size_t> wordIdx;
	for (size_t r = 0; r < rows.size(); r++) {
		if (rows[r].word && !rows[r].text.empty()) wordIdx.push_back(r);
	}
	std::sort(wordIdx.begin(), wordIdx.end(), [&](size_t a, size_t b) {
		const int ca = rows[a].y * 2 + rows[a].h, cb = rows[b].y * 2 + rows[b].h;
		if (ca != cb) return ca < cb;
		return rows[a].x < rows[b].x;
	});
	std::vector<std::vector<size_t>> lines;
	for (size_t idx : wordIdx) {
		bool placed = false;
		if (!lines.empty()) {
			const size_t anchor = lines.back().front();
			const int reach = (std::max)(12, (int)(1.2 * (std::max)(rows[idx].h, rows[anchor].h)));
			if (abs((rows[idx].y * 2 + rows[idx].h) - (rows[anchor].y * 2 + rows[anchor].h)) <= reach) {
				lines.back().push_back(idx);
				placed = true;
			}
		}
		if (!placed) lines.push_back({ idx });
	}

	const l_int32 pw = pixGetWidth(pix), ph = pixGetHeight(pix);
	bool configured = false;
	int rescans = 0;
	static const int CELL_GAP_PX = 60;

	for (auto& line : lines) {
		if (rescans >= COUNTER_RESCAN_LIMIT) break;
		std::sort(line.begin(), line.end(), [&](size_t a, size_t b) { return rows[a].x < rows[b].x; });

		// Cells are runs of words with no wide gap between them; only a
		// cell's tail can be a counter
		size_t cellStart = 0;
		for (size_t wpos = 1; wpos <= line.size(); wpos++) {
			const bool cellEnd = wpos == line.size() ||
				rows[line[wpos]].x - (rows[line[wpos - 1]].x + rows[line[wpos - 1]].w) > CELL_GAP_PX;
			if (!cellEnd) continue;
			const size_t lastw = wpos - 1;
			const size_t cellLen = lastw - cellStart + 1;
			cellStart = wpos;
			if (rescans >= COUNTER_RESCAN_LIMIT) break;

			// Longest suspect tail of the cell, up to three words
			for (size_t k = (std::min)((size_t)3, cellLen); k >= 1; k--) {
				std::string joined;
				for (size_t t = lastw - k + 1; t <= lastw; t++) joined += rows[line[t]].text;
				// A tail that already reads clean is this cell's counter; a
				// rescan of part of it could only replace right with wrong
				if (cleanCounter(joined)) break;
				if (!counterSuspect(joined)) continue;

				int x0 = INT_MAX, y0 = INT_MAX, x1 = 0, y1 = 0;
				for (size_t t = lastw - k + 1; t <= lastw; t++) {
					const Row& rw = rows[line[t]];
					x0 = (std::min)(x0, rw.x); y0 = (std::min)(y0, rw.y);
					x1 = (std::max)(x1, rw.x + rw.w); y1 = (std::max)(y1, rw.y + rw.h);
				}
				// Task-screen counters are ~15px tall at 1080p; the only other
				// place this shape appears is inventory stack counts in 10px
				// micro-text, which are none of our business and misread easily
				if (y1 - y0 < 12) break;
				// A counter is a few glyphs; anything much bigger is misread UI
				if (x1 - x0 > 240 || y1 - y0 > 40) break;
				x0 = (std::max)(0, x0 - 4); y0 = (std::max)(0, y0 - 3);
				x1 = (std::min)((int)pw, x1 + 4); y1 = (std::min)((int)ph, y1 + 3);
				if (x1 - x0 < 6 || y1 - y0 < 6) break;

				if (!configured) {
					tess.SetPageSegMode(tesseract::PSM_SINGLE_LINE);
					tess.SetVariable("tessedit_char_whitelist", "0123456789/");
					tess.SetVariable("classify_bln_numeric_mode", "1");
					tess.SetVariable("preserve_interword_spaces", "0");
					configured = true;
				}

				// Grayscale, scaled up smoothly, and nothing else: the glyphs are
				// mid-grey antialiased 15px digits, and hard-thresholding them
				// before scaling turns them into jagged blobs that sprout
				// phantom strokes. Tesseract reads the clean grayscale directly.
				BOX* box = boxCreate(x0, y0, x1 - x0, y1 - y0);
				PIX* crop = pixClipRectangle(pix, box, NULL);
				boxDestroy(&box);
				if (!crop) break;
				PIX* gray = pixConvertRGBToGray(crop, 0.3f, 0.59f, 0.11f);
				std::string reading;
				if (gray) {
					PIX* big = pixScale(gray, COUNTER_RESCAN_SCALE, COUNTER_RESCAN_SCALE);
					if (big) {
						tess.SetImage(big);
						tesseract::ETEXT_DESC monitor;
						monitor.set_deadline_msecs(400);
						tess.Recognize(&monitor);
						char* out = tess.GetUTF8Text();
						if (out) {
							for (const char* c = out; *c; c++) {
								if (!isspace((unsigned char)*c)) reading += *c;
							}
							delete[] out;
						}
						pixDestroy(&big);
					}
					pixDestroy(&gray);
				}
				pixDestroy(&crop);
				rescans++;

				if (cleanCounter(reading)) {
					for (size_t t = lastw - k + 1; t <= lastw; t++) rows[line[t]].raw += "\t" + reading;
				}
				break;
			}
		}
	}

	if (configured) {
		// Back to the fast tooltip configuration
		tess.SetPageSegMode(tesseract::PSM_SINGLE_BLOCK);
		tess.SetVariable("tessedit_char_whitelist", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,$€₽@- ");
		tess.SetVariable("classify_bln_numeric_mode", "1");
		tess.SetVariable("preserve_interword_spaces", "0");
	}

	std::string out;
	out.reserve(tsv.size() + 256);
	for (const Row& row : rows) { out += row.raw; out += '\n'; }
	return out;
}

// OCR of the notification strip: bright pixels only, as black text on a white
// page, and no OCR at all when there is nothing bright
static std::string ocrToast(tesseract::TessBaseAPI& tess, PIX* pix, const std::string& dumpPath) {
	std::string result;
	PIX* rgb = pixGetDepth(pix) == 32 ? pix : pixConvertTo32(pix);
	PIX* gray = rgb ? pixConvertRGBToGray(rgb, 0.3f, 0.59f, 0.11f) : nullptr;
	PIX* bin = gray ? pixThresholdToBinary(gray, TOAST_BRIGHT_THRESHOLD) : nullptr;
	if (bin) {
		pixInvert(bin, bin);
		l_int32 bright = 0;
		pixCountPixels(bin, &bright, NULL);
		if (!dumpPath.empty()) {
			std::string binPath = dumpPath;
			size_t dot = binPath.find_last_of('.');
			binPath.insert(dot == std::string::npos ? binPath.size() : dot, "-bin");
			pixWritePng(binPath.c_str(), bin, 0.0f);
		}
		if (bright >= TOAST_MIN_BRIGHT_PIXELS) {
			result = ocrPage(tess, bin, 1.0f, TOAST_OCR_DEADLINE_MS);
		}
	}
	if (bin) pixDestroy(&bin);
	if (gray) pixDestroy(&gray);
	if (rgb && rgb != pix) pixDestroy(&rgb);
	return result;
}

// Coarse sample of a capture (every 7th row, every 11th column), taken from
// the raw BGRA capture before any conversion. A "SCAN IFCHANGED" compares it
// with the sample of the screen that was last actually OCR'd and calls the
// screen unchanged unless more than 0.5% of the samples moved by a visible
// amount - so a ticking clock or a blinking cursor does not trigger another
// OCR, but a single new tick mark keeps accumulating until the frame is
// re-read. A plain "SCAN" always reads and resets the baseline.
static std::vector<l_uint32> g_lastOcrSamples;
static std::vector<l_uint32> g_sampleScratch;

static void sampleScreen(const uint8_t* pixels, int w, int h, int stride, std::vector<l_uint32>& out, const std::vector<ScreenRect>& exclude) {
	out.clear();
	out.reserve((size_t)(h / 7 + 1) * (size_t)(w / 11 + 1));
	for (int y = 0; y < h; y += 7) {
		const uint8_t* row = pixels + (size_t)y * stride;
		for (int x = 0; x < w; x += 11) {
			// Our own overlay windows are excluded: their text changes on its
			// own (countdowns, live counters) and would make every capture
			// look like a changed screen
			bool skip = false;
			for (const ScreenRect& r : exclude) {
				if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { skip = true; break; }
			}
			if (skip) {
				out.push_back(0);
				continue;
			}
			const uint8_t* px = row + (size_t)x * 4; // BGRA
			out.push_back(((l_uint32)px[2] << 16) | ((l_uint32)px[1] << 8) | px[0]);
		}
	}
}

static bool samplesUnchanged(const std::vector<l_uint32>& a, const std::vector<l_uint32>& b) {
	if (a.empty() || a.size() != b.size()) return false;
	const size_t allowed = a.size() / 200;
	size_t differing = 0;
	for (size_t i = 0; i < a.size(); i++) {
		const int dr = (int)((a[i] >> 16) & 0xff) - (int)((b[i] >> 16) & 0xff);
		const int dg = (int)((a[i] >> 8) & 0xff) - (int)((b[i] >> 8) & 0xff);
		const int db = (int)(a[i] & 0xff) - (int)(b[i] & 0xff);
		if (abs(dr) + abs(dg) + abs(db) > 48 && ++differing > allowed) return false;
	}
	return true;
}
static const char* UNCHANGED_PAGE = "UNCHANGED";

// OCR a screen region (or the whole primary screen). A partial region is the
// in-raid notification strip: it is reduced to its bright pixels first and
// skipped entirely when there is nothing bright, so the 2s polling costs next
// to nothing while nothing is on screen. Excluded rectangles (our own overlay
// windows) are blacked out so their text is never read as a notification.
static std::string scanScreenRegion(tesseract::TessBaseAPI& tess, int x, int y, int w, int h, const std::string& dumpPath = std::string(), const std::vector<ScreenRect>& exclude = std::vector<ScreenRect>(), bool onlyIfChanged = false) {
	std::string result;
	if (!cachedDesktopDC) return result;

	int screenW = GetSystemMetrics(SM_CXSCREEN);
	int screenH = GetSystemMetrics(SM_CYSCREEN);
	if (screenW <= 0 || screenH <= 0) return result;
	bool fullScreen = (w <= 0 || h <= 0);
	if (fullScreen) { x = 0; y = 0; w = screenW; h = screenH; }
	if (x < 0) x = 0;
	if (y < 0) y = 0;
	if (x + w > screenW) w = screenW - x;
	if (y + h > screenH) h = screenH - y;
	if (w <= 10 || h <= 10) return result;

	Image img(cachedDesktopDC, x, y, w, h);
	if (fullScreen) {
		// Decide "unchanged" on the raw capture, before paying for the
		// RGB conversion and the OCR
		sampleScreen(img.GetPixels(), img.GetWidth(), img.GetHeight(), img.GetBytesPerScanLine(), g_sampleScratch, exclude);
		if (onlyIfChanged && samplesUnchanged(g_sampleScratch, g_lastOcrSamples)) return UNCHANGED_PAGE;
		g_lastOcrSamples.swap(g_sampleScratch);
	}
	PIX* pix = pixFromImage(img);
	if (!pix) return result;

	for (const ScreenRect& r : exclude) {
		int ex = (std::max)(r.x, x), ey = (std::max)(r.y, y);
		int ex2 = (std::min)(r.x + r.w, x + w), ey2 = (std::min)(r.y + r.h, y + h);
		if (ex2 <= ex || ey2 <= ey) continue;
		BOX* box = boxCreate(ex - x, ey - y, ex2 - ex, ey2 - ey);
		pixClearInRect(pix, box);
		boxDestroy(&box);
	}

	if (!dumpPath.empty()) {
		// Diagnostic: keep what the OCR actually saw
		pixWritePng(dumpPath.c_str(), pix, 0.0f);
	}

	if (fullScreen) {
		result = constrainCounters(tess, annotateTicks(ocrPage(tess, pix, 1.0f, PAGE_OCR_DEADLINE_MS), pix), pix);
	}
	else {
		result = ocrToast(tess, pix, dumpPath);
	}
	pixDestroy(&pix);
	return result;
}

// OCR an image file (offline testing of the toast / Tasks screen parsers).
// asToast runs the notification pipeline instead of the plain page OCR.
static std::string scanImageFile(tesseract::TessBaseAPI& tess, const std::string& path, float scale, bool asToast = false) {
	PIX* pix = pixRead(path.c_str());
	if (!pix) return std::string();
	std::string result = asToast
		? ocrToast(tess, pix, path + ".debug.png")
		: constrainCounters(tess, annotateTicks(ocrPage(tess, pix, scale, PAGE_OCR_DEADLINE_MS), pix), pix);
	pixDestroy(&pix);
	return result;
}

static void rtrim(std::string& s) {
	// Define the characters to trim (common whitespaces)
	const std::string whitespaces = " \t\n\r\f\v";

	// Find the position of the last non-whitespace character
	size_t last_non_space = s.find_last_not_of(whitespaces);

	// If a non-whitespace character is found, resize the string to end just after it
	if (last_non_space != std::string::npos) {
		s.erase(last_non_space + 1);
	}
	else {
		// If the string contains only whitespace (or is empty), clear it
		s.clear();
	}
}

int main(int argc, char* argv[])
{
	// Set DPI awareness to ensure cursor coordinates match actual screen pixels
	SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
	// Background helper: the game always gets the CPU first
	SetPriorityClass(GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS);

	// Parse optional command line arguments for border color: red green blue
	if (argc >= 4) {
		try {
			borderColorRed = static_cast<short>(std::stoi(argv[1]));
			borderColorGreen = static_cast<short>(std::stoi(argv[2]));
			borderColorBlue = static_cast<short>(std::stoi(argv[3]));
		}
		catch (const std::exception& e) {
			std::cerr << "Error parsing color arguments. Using default values." << std::endl;
		}
	}

	short CURSOR_TOOLTIP_OFFSET_X{};
	short CURSOR_TOOLTIP_OFFSET_Y{};

	WCHAR exe_path[MAX_PATH];
	GetModuleFileNameW(NULL, exe_path, MAX_PATH);

	// 2. Extract the directory path
	std::wstring ws_exe_path(exe_path);
	std::wstring exe_dir = ws_exe_path.substr(0, ws_exe_path.find_last_of(L"\\/"));

	std::ifstream file(exe_dir + L"\\scanningConfig.json");

	// Check if the file opened successfully
	if (!file.is_open()) {
		cout << "IGNORE||NO CONFIG FILE FOUND" << endl;
		CURSOR_TOOLTIP_OFFSET_X = 13;
		CURSOR_TOOLTIP_OFFSET_Y = -13;
		//return 0;
	}
	else
	{
		cout << "IGNORE||CONFIG FILE FOUND" << endl;
		// Parse the JSON data directly from the input stream
		json data = json::parse(file);

		// Close the file (optional, as the ifstream destructor does this automatically)
		file.close();

		CURSOR_TOOLTIP_OFFSET_X = data["offsetX"];
		CURSOR_TOOLTIP_OFFSET_Y = data["offsetY"];
	}

	// Initialize cached desktop DC (optimization #2)
	cachedDesktopWindow = GetDesktopWindow();
	cachedDesktopDC = GetDC(cachedDesktopWindow);
	if (!cachedDesktopDC) {
		cerr << "Failed to get desktop DC" << endl;
		exit(1);
	}

	tesseract::TessBaseAPI tess;
	if (tess.Init(NULL, "eng") != 0) {
		// Init failed
		tess.End();
		ReleaseDC(cachedDesktopWindow, cachedDesktopDC);
		exit(1);
	}

	// Optimize Tesseract settings for speed (optimization #3)
	tess.SetPageSegMode(tesseract::PSM_SINGLE_BLOCK); // Faster than default
	tess.SetVariable("tessedit_char_whitelist", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,$€₽@- "); // Common characters
	tess.SetVariable("classify_bln_numeric_mode", "1"); // Enable numeric mode for faster processing
	// Track last scanned cursor position - only scan once per position
	static POINT lastScannedCursor = {0, 0};

	string scanText{};
	short checkRange = 50;
	short red = 0;
	short green = 0;
	short blue = 0;
	POINT mousePos{};
	POINT lastValidMousePos{};
	POINT bottomLeftBorderPoint{};
	LONG width = 0;
	LONG height = 0;
	short offsetX = 0;
	short offsetY = 0;
	POINT bottomRightBorderPoint{};
	POINT topLeftBorderPoint{};
	//bool mouseIsStationary = false;
	short mouseStationaryCount = 0;
	bool foundTooltip = false;
	bool borderIsVisible = false;
	bool showedMouseMoved = false;

	short horizontalCheckpoints[3] = { 50, 15, 5 };
	short verticalCheckpoints[3] = { -15, -5, -2 };
	// Negative steps: walk left along the bottom border to the true corner
	short leftwardCheckpoints[4] = { -50, -15, -5, -1 };
	
	// Ctrl+wheel hook lives on its own thread (see WheelHookThread)
	std::thread wheelHookThread(WheelHookThread);
	wheelHookThread.detach();

	// Optimized polling loop (optimization #7)
	int sleepInterval = 25; // Default sleep interval
	// Heartbeat: proves to the main process that this loop is still running,
	// so a wedged helper can be restarted instead of silently doing nothing
	auto lastHeartbeat = std::chrono::steady_clock::now();

	while (true) {
		{
			auto now = std::chrono::steady_clock::now();
			if (std::chrono::duration_cast<std::chrono::seconds>(now - lastHeartbeat).count() >= 5) {
				lastHeartbeat = now;
				std::lock_guard<std::mutex> lock(g_stdoutMutex);
				cout << "ALIVE||" << (g_wheelHookEnabled.load() ? 1 : 0) << endl;
				fflush(stdout);
			}
		}
		// On-demand commands from the main process
		std::string command;
		if (readStdinLine(command)) {
			if (command == "WHEELHOOK ON") {
				g_wheelHookEnabled.store(true);
			}
			else if (command == "WHEELHOOK OFF") {
				g_wheelHookEnabled.store(false);
			}
			else if (command == "SCAN" || command.rfind("SCAN ", 0) == 0 || command.rfind("SCANREGION ", 0) == 0 || command.rfind("SCANFILE ", 0) == 0 || command.rfind("SCANTOAST ", 0) == 0) {
				std::string page;
				if (command.rfind("SCANTOAST ", 0) == 0) {
					page = scanImageFile(tess, command.substr(10), 1.0f, true);
				}
				else if (command.rfind("SCANFILE ", 0) == 0) {
					// SCANFILE <scale> <path>
					float scale = 1.0f;
					char pathBuf[1024] = { 0 };
					sscanf_s(command.c_str() + 9, "%f %1023[^\n]", &scale, pathBuf, (unsigned)sizeof(pathBuf));
					page = scanImageFile(tess, pathBuf, scale);
				}
				else {
					// "SCAN [IFCHANGED] | SCANREGION x y w h" followed, for
					// either shape, by "[EXCLUDE x y w h]... [DUMP <path>]"
					int rx = 0, ry = 0, rw = 0, rh = 0;
					std::string dumpPath;
					std::vector<ScreenRect> exclude;
					const bool onlyIfChanged = command.find(" IFCHANGED") != std::string::npos;
					if (command.rfind("SCANREGION ", 0) == 0) {
						sscanf_s(command.c_str() + 11, "%d %d %d %d", &rx, &ry, &rw, &rh);
					}
					const size_t dumpAt = command.find(" DUMP ");
					if (dumpAt != std::string::npos) dumpPath = command.substr(dumpAt + 6);
					size_t at = command.find(" EXCLUDE ");
					while (at != std::string::npos && (dumpAt == std::string::npos || at < dumpAt)) {
						ScreenRect r = { 0, 0, 0, 0 };
						if (sscanf_s(command.c_str() + at + 9, "%d %d %d %d", &r.x, &r.y, &r.w, &r.h) == 4 && r.w > 0 && r.h > 0) {
							exclude.push_back(r);
						}
						at = command.find(" EXCLUDE ", at + 9);
					}
					page = scanScreenRegion(tess, rx, ry, rw, rh, dumpPath, exclude, onlyIfChanged);
				}
				std::lock_guard<std::mutex> lock(g_stdoutMutex);
				cout << "SCANRESULT_BEGIN" << endl;
				cout << page << endl;
				cout << "SCANRESULT_END" << endl;
				fflush(stdout);
			}
		}

		if (GetCursorPos(&mousePos)) {
			if (lastValidMousePos.x == mousePos.x && lastValidMousePos.y == mousePos.y) {
				if (mouseStationaryCount < 1000) mouseStationaryCount++; // capped: a short would wrap after ~13 min
				// Normal interval when stationary; after ~2s with nothing found
				// (e.g. the cursor locked at screen centre for a whole raid) back
				// off to 100ms so the screen capture runs 10x/s instead of 40x/s.
				// Any mouse movement resets this, so hover latency is unaffected.
				sleepInterval = (mouseStationaryCount > 80 && !foundTooltip) ? 100 : 25;
			}
			else
			{
				if (showedMouseMoved == false) {
					std::lock_guard<std::mutex> lock(g_stdoutMutex);
					cout << "MOUSEMOVE" << endl;
					fflush(stdout);
					showedMouseMoved = true;
				}
				mouseStationaryCount = 0;
				foundTooltip = false;
				sleepInterval = 50; // Longer interval when moving (optimization #7)
				cachedPixelBuffer.pixels.clear(); // Clear pixel cache
				lastScannedCursor = {0, 0}; // Reset last scanned cursor position
			}

			bottomLeftBorderPoint.x = mousePos.x + CURSOR_TOOLTIP_OFFSET_X;
			bottomLeftBorderPoint.y = mousePos.y + CURSOR_TOOLTIP_OFFSET_Y;

			// Check if we've already scanned this cursor position
			bool alreadyScanned = (mousePos.x == lastScannedCursor.x && mousePos.y == lastScannedCursor.y);
			
			// Only try to detect and scan tooltip if we haven't scanned this cursor position yet
			if (mouseStationaryCount > 2 && !foundTooltip && !alreadyScanned) {
				// Capture a larger region around the expected tooltip area for batch pixel reading (optimization #1)
				// Increased size to ensure we cover all border detection pixels
				int captureX = bottomLeftBorderPoint.x - 100;
				int captureY = bottomLeftBorderPoint.y - 200;
				int captureWidth = 600;
				int captureHeight = 300;
				
				// Ensure coordinates are valid
				if (captureX < 0) captureX = 0;
				if (captureY < 0) captureY = 0;
				
				// Force recapture to ensure fresh pixel data
				capturePixelRegion(cachedDesktopDC, captureX, captureY, captureWidth, captureHeight, true);

				if (pixelIsValid(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue)) {
					borderIsVisible = true;
				}
				// Check the pixel to the top right of the config one
				else if (pixelIsValid(bottomLeftBorderPoint.x + 1, bottomLeftBorderPoint.y - 1, red, green, blue)) {
					bottomLeftBorderPoint.x++;
					bottomLeftBorderPoint.y--;
					borderIsVisible = true;
				}
				// Check the pixel to the bottom left of the config one
				else if (pixelIsValid(bottomLeftBorderPoint.x - 1, bottomLeftBorderPoint.y + 1, red, green, blue)) {
					bottomLeftBorderPoint.x--;
					bottomLeftBorderPoint.y++;
					borderIsVisible = true;
				}

				if (borderIsVisible) {
					borderIsVisible = false;
					offsetX = 0;
					offsetY = 0;
					//cout << bottomLeftBorderPoint.x << ',' << bottomLeftBorderPoint.y << endl;

					foundTooltip = true;

					// Near the right edge of the screen the game shifts its tooltip
					// left to keep it on-screen, so the calibrated point lands somewhere
					// along the bottom border rather than on the bottom-left corner.
					// Walk left along the border to find the real corner first; the
					// one-off wider capture gives that walk pixel data to read from.
					{
						int wideX = bottomLeftBorderPoint.x - 900;
						int wideY = bottomLeftBorderPoint.y - 200;
						if (wideX < 0) wideX = 0;
						if (wideY < 0) wideY = 0;
						capturePixelRegion(cachedDesktopDC, wideX, wideY, 1500, 300, true);

						short leftOffset = 0;
						for (short step : leftwardCheckpoints) {
							getBottomRightBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, leftOffset, step);
						}
						bottomLeftBorderPoint.x += leftOffset; // leftOffset <= 0
					}

					for (short i = 0; i < std::size(horizontalCheckpoints); i++) {
						checkRange = horizontalCheckpoints[i];
						getBottomRightBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, offsetX, checkRange);
					}

					bottomRightBorderPoint.x = bottomLeftBorderPoint.x + offsetX;
					bottomRightBorderPoint.y = bottomLeftBorderPoint.y;

					for (short i = 0; i < std::size(verticalCheckpoints); i++) {
						checkRange = verticalCheckpoints[i];
						getTopLeftBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, offsetY, checkRange);
					}

					topLeftBorderPoint.x = bottomLeftBorderPoint.x;
					topLeftBorderPoint.y = bottomLeftBorderPoint.y + offsetY;

					//cout << topLeftBorderPoint.x << ',' << topLeftBorderPoint.y << "|" << bottomRightBorderPoint.x << ',' << bottomRightBorderPoint.y << endl;

					width = bottomRightBorderPoint.x - bottomLeftBorderPoint.x;
					height = bottomLeftBorderPoint.y - topLeftBorderPoint.y;
					//cout << "Width: " << width << ", Height: " << height << ", Offset X: " << offsetX << ", Offset Y: " << offsetY << endl;

					if (width > 10 && height > 10) {
						// Perform OCR (only once per cursor position)
						scanText = scanForText(tess, topLeftBorderPoint.x + 1, topLeftBorderPoint.y + 1, width, height);
						
						// Apply regex replacements using pre-compiled patterns (optimization #6)
						scanText = regex_replace(scanText, regexNewlineCRLF, " ");
						scanText = regex_replace(scanText, regexNewlineLF, " ");
						scanText = regex_replace(scanText, regexAtSymbol, "0");
						
						// Mark this cursor position as scanned
						if (scanText.length() > 3) {
							lastScannedCursor = mousePos;
							rtrim(scanText);
							std::lock_guard<std::mutex> lock(g_stdoutMutex);
							cout << scanText << "||" << mousePos.x << "," << mousePos.y << endl;
							fflush(stdout);
							showedMouseMoved = false;
						}
					}
				}
			}

			lastValidMousePos = mousePos;
		}

		std::this_thread::sleep_for(std::chrono::milliseconds(sleepInterval));
	}

	tess.End();
	ReleaseDC(cachedDesktopWindow, cachedDesktopDC);
	return 0;
}