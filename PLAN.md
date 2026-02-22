# სამოქმედო გეგმა — MED&გზურის ძიებისა და PDF-ის გამოსწორება

## პრობლემების შეჯამება

**მომხმარებლის სკრინშოტებიდან დაფიქსირდა:**
1. ძიების შედეგები ინგლისურ ენაზეა (ქართულის ნაცვლად)
2. PDF ანგარიში მარცხნიდან ჭრის ტექსტს
3. PDF მხოლოდ 1 გვერდს აგენერირებს
4. PDF-ში კონტენტი ცარიელი ან ინგლისურია

---

## ეტაპი 1: Perplexity-ს ქართულთან ადაპტაცია
**ფაილი:** `api/search.js` — ხაზი 421-433

**პრობლემა:** Perplexity-ს system prompt სრულად ინგლისურია. ეძებს ინგლისურ წყაროებს, აბრუნებს ინგლისურ ტექსტს. ეს არის #1 მიზეზი რატომაც შედეგები ინგლისურად ჩანს.

**გამოსწორება:**
- System prompt-ს დავამატებთ ინსტრუქციას: ეძებოს ინგლისურად (სამედიცინო წყაროები ინგლისურია) მაგრამ პასუხი მოამზადოს ისე რომ Claude-ს ქართულად თარგმნა გაუადვილდეს
- დავამატებთ: "Structure your findings clearly with numbered points" რომ Claude-ს JSON parsing გაუადვილდეს

---

## ეტაპი 2: Claude-ს error handling — Demo fallback
**ფაილი:** `api/search.js` — ხაზი 565-613

**პრობლემა:** როცა Claude API ვერ მუშაობს (timeout, error), კოდი `throw`-ს აკეთებს და მომხმარებელი ხედავს ზოგად error-ს. Demo მონაცემებზე არ გადადის.

**გამოსწორება:**
- `throw err` (ხაზი 613) → `getDemoResult()` fallback
- `throw new Error('Claude API failed')` (ხაზი 571) → `getDemoResult()` fallback
- ანუ: Claude fail → თარგმანის fallback → demo მონაცემები (არასდროს throw)

---

## ეტაპი 3: Demo mode ლოგიკის გამოსწორება
**ფაილი:** `api/search.js` — ხაზი 174

**პრობლემა:** `if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY)` — ორივე უნდა არ ჰქონდეს. თუ მხოლოდ Perplexity აქვს (Claude-ს არა), demo არ ირთვება და ინგლისური ტექსტი ჩნდება.

**გამოსწორება:**
- `&&` → `||` არ ვცვლით (ორივე key-ის ქონა ნორმალურია)
- ნაცვლად: claudeAnalyze-ში throw-ს ვცვლით fallback-ით (ეტაპი 2-ით ისედაც სწორდება)

---

## ეტაპი 4: extractJSON-ის გაუმჯობესება
**ფაილი:** `api/search.js` — ხაზი 675-721

**პრობლემა:** `extractJSON` ვერ ცნობს Claude-ს report ფორმატს (`sections` ველით), მხოლოდ `items/meta/summary`-ს ეძებს. ამიტომ report-ის JSON parsing ხშირად ვერ ხერხდება.

**გამოსწორება:**
- ხაზი 682, 691, 714: validation-ში `parsed.sections`-ის დამატება
- `if (parsed.items || parsed.meta || parsed.summary)` → `if (parsed.items || parsed.meta || parsed.summary || parsed.sections)`

---

## ეტაპი 5: PDF — document.fonts.ready
**ფაილი:** `product.html` — downloadReport() ფუნქცია

**პრობლემა:** html2pdf იწყებს რენდერს სანამ Noto Sans Georgian ფონტი ჩაიტვირთება. შედეგად ქართული ტექსტი fallback ფონტით ჩანს ან საერთოდ არ ჩანს.

**გამოსწორება:**
- html2pdf-ის გამოძახებამდე დავამატებთ: `await document.fonts.ready;`

---

## ეტაპი 6: buildLocalReport-ის გაუმჯობესება
**ფაილი:** `product.html` — ხაზი 1870-1904

**პრობლემა:** `buildLocalReport` მხოლოდ `result.items`-ს იყენებს. თუ API-მ ახალი ფორმატი `result.sections` დააბრუნა (n8n-იდან), ეს მონაცემები იკარგება და PDF ცარიელი ან არასრულია.

**გამოსწორება:**
- `result.sections`-ის შემოწმების დამატება `result.items`-ის წინ
- sections-იდან items-ის ამოღება და კონტენტში ჩასმა

---

## ეტაპი 7: Commit და Push
- ყველა ცვლილების commit ერთად
- Push `claude/diagnose-vercel-search-FWSud` ბრანჩზე
- მომხმარებელს ეტყვით: დამერჯეთ main-ში

---

## ცვლილებების თანმიმდევრობა

```
ეტაპი 1 → api/search.js (Perplexity prompt)
ეტაპი 2 → api/search.js (Claude error handling)
ეტაპი 3 → — (ეტაპი 2-ით სწორდება)
ეტაპი 4 → api/search.js (extractJSON)
ეტაპი 5 → product.html (fonts.ready)
ეტაპი 6 → product.html (buildLocalReport)
ეტაპი 7 → git commit + push
```

## რისკები
- Claude-ს model ID `claude-sonnet-4-5-20250514` — თუ ეს მოდელი მიუწვდომელია Anthropic-ზე, ყველა Claude call ჩავარდება. ეტაპი 2-ის fallback ამას ამცირებს.
- Perplexity-ს `sonar` მოდელი — თუ deprecated გახდა, ძიება ვერ იმუშავებს. Demo mode-ზე გადავა.
