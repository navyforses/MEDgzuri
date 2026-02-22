// MED&გზური AI Chatbot
// Rule-based chatbot with keyword matching

const ChatBot = {
    isOpen: false,
    messages: [],
    
    // Knowledge base - responses in Georgian
    knowledgeBase: {
        greetings: {
            keywords: ['გამარჯობა', 'გამარჯობ', 'hello', 'hi', 'hey', 'სალამი', 'ბონჟურნო'],
            responses: [
                'გამარჯობა! 👋 მე MED&გზურის ვირტუალური ასისტენტი ვარ. რით შემიძლია დაგეხმაროთ?',
                'სალამი! 🙌 როგორ შემიძლია დაგეხმაროთ დღეს?'
            ]
        },
        
        services: {
            keywords: ['სერვისი', 'სერვისები', 'რას აკეთებთ', 'რა გთავაზობთ', 'services', 'what do you do', 'help'],
            responses: [
                `ჩვენ გთავაზობთ შემდეგ სერვისებს:\n\n` +
                `1️⃣ **კვლევითი გზამკვლევი** (80-200₾)\n` +
                `   - PubMed-ის კვლევების მოძიება\n` +
                `   - PDF ანგარიში ქართულად\n\n` +
                `2️⃣ **აქტიური მხარდაჭერა** (300-600₾)\n` +
                `   - კლინიკებთან კომუნიკაცია\n` +
                `   - კლინიკურ კვლევებში განაცხადი\n\n` +
                `3️⃣ **თარგმნითი სერვისი** (500-1500₾)\n` +
                `   - სამედიცინო დოკუმენტების თარგმანი\n\n` +
                `გსურთ რომელიმე სერვისის შესახებ მეტი გაიგოთ?`
            ]
        },
        
        researchGuide: {
            keywords: ['გზამკვლევი', 'კვლევა', 'pubmed', 'research guide', 'პუბმედ'],
            responses: [
                `**კვლევითი გზამკვლევი** (80-200₾)\n\n` +
                `📋 რას მოიცავს:\n` +
                `• თქვენი დიაგნოზის მიხედვით კვლევების მოძიება\n` +
                `• PubMed-ის და ClinicalTrials.gov-ის გამოყენება\n` +
                `• კლინიკური კვლევების ძიება\n` +
                `• სტრუქტურირებული PDF ანგარიში ქართულად\n\n` +
                `⏱️ დრო: 24-48 საათი\n\n` +
                `გინდათ შეკვეთა? 👇`
            ]
        },
        
        activeSupport: {
            keywords: ['მხარდაჭერა', 'აქტიური', 'კომუნიკაცია', 'კლინიკა', 'support', 'clinic'],
            responses: [
                `**აქტიური მხარდაჭერა** (300-600₾)\n\n` +
                `🤝 რას მოიცავს:\n` +
                `• კლინიკებთან და მკვლევარებთან ელ-ფოსტების შედგენა\n` +
                `• კლინიკურ კვლევაში განაცხადის მომზადება\n` +
                `• მიმოწერის მართვა თქვენი სახელით\n` +
                `• პასუხების თარგმნა და ანალიზი\n\n` +
                `⏱️ დრო: მუდმივი მხარდაჭერა\n\n` +
                `გინდათ შეკვეთა? 👇`
            ]
        },
        
        translation: {
            keywords: ['თარგმანი', 'თარგმნა', 'translate', 'translation', 'ენა'],
            responses: [
                `**სრული თარგმნითი სერვისი** (500-1500₾)\n\n` +
                `🌐 რას მოიცავს:\n` +
                `• სამედიცინო დოკუმენტაციის პროფესიონალური თარგმანი\n` +
                `• ვიდეო-კონსულტაციებზე თარჯიმნის უზრუნველყოფა\n` +
                `• უცხოელ სპეციალისტებთან კონსულტაციის კოორდინაცია\n\n` +
                `⏱️ დრო: ინდივიდუალურად\n\n` +
                `გინდათ შეკვეთა? 👇`
            ]
        },
        
        prices: {
            keywords: ['ფასი', 'ფასები', 'ღირს', 'რამდენია', 'price', 'cost', 'how much'],
            responses: [
                `💰 **ჩვენი ფასები:**\n\n` +
                `📋 კვლევითი გზამკვლევი: **80-200₾**\n` +
                `🤝 აქტიური მხარდაჭერა: **300-600₾**\n` +
                `🌐 თარგმნითი სერვისი: **500-1500₾**\n` +
                `📅 ყოველთვიური მონიტორინგი: **30-50₾/თვე**\n\n` +
                `✅ **პირველი კონსულტაცია უფასოა!**\n\n` +
                `გსურთ შეკვეთა?`
            ]
        },
        
        time: {
            keywords: ['დრო', 'როდის', 'ხანდაზმულობა', 'time', 'when', 'how long', 'სწრაფად'],
            responses: [
                `⏱️ **სამუშაო დრო:**\n\n` +
                `• კვლევითი გზამკვლევი: **24-48 საათი**\n` +
                `• აქტიური მხარდაჭერა: **მუდმივი**\n` +
                `• თარგმნითი სერვისი: **ინდივიდუალურად**\n` +
                `• პასუხი შეკითხვაზე: **24 საათში**\n\n` +
                `🚀 სასწრაფო შეკვეთის შემთხვევაში შეგვიძლია უფრო სწრაფადაც!`
            ]
        },
        
        process: {
            keywords: ['პროცესი', 'როგორ', 'ნაბიჯი', 'process', 'how to', 'steps', 'step'],
            responses: [
                `📍 **როგორ მუშაობს:**\n\n` +
                `**1️⃣ აღწერეთ მდგომარეობა**\n` +
                `   გამოგვიგზავნეთ დიაგნოზი - ტექსტით, ხმოვნად ან ფოტოთი\n\n` +
                `**2️⃣ ჩვენ მოვიძიებთ**\n` +
                `   ვეძებთ PubMed-ზე, ვთარგმნით, ვასტრუქტურირებთ\n\n` +
                `**3️⃣ მიიღეთ შედეგი**\n` +
                `   PDF ანგარიში ქართულად + გაგრძელება საჭიროებისამებრ\n\n` +
                `დავიწყოთ? 😊`
            ]
        },
        
        contact: {
            keywords: ['კონტაქტი', 'დამიკავშირდით', 'როგორ დაგიკავშირდეთ', 'contact', 'reach you', 'phone', 'ნომერი'],
            responses: [
                `📞 **ჩვენი კონტაქტები:**\n\n` +
                `📱 WhatsApp: **+995 555 145 719**\n` +
                `💬 Facebook: **MED&გზური**\n` +
                `📧 Email: info@medgzuri.ge\n\n` +
                `⏰ **სამუშაო საათები:**\n` +
                `ორშაბათი-პარასკევი: 10:00 - 18:00\n\n` +
                `პასუხი 24 საათში! 🚀`
            ]
        },
        
        consultation: {
            keywords: ['კონსულტაცია', 'უფასო', 'free', 'consultation', 'პირველი'],
            responses: [
                `✅ **პირველი კონსულტაცია უფასოა!**\n\n` +
                `რას მიიღებთ:\n` +
                `• თქვენი შეკითხვის განხილვა\n` +
                `• რეკომენდაცია სერვისის შესახებ\n` +
                `• ზოგადი ორიენტაცია\n\n` +
                `📞 დაგვიკავშირდით WhatsApp-ზე ან შეავსეთ ფორმა საიტზე!`
            ]
        },
        
        medicalAdvice: {
            keywords: ['ექიმი', 'დიაგნოზი', 'მკურნალობა', 'მედიცინა', 'doctor', 'diagnosis', 'treatment', 'medicine'],
            responses: [
                `⚕️ **მნიშვნელოვანი შეხსენება:**\n\n` +
                `ჩვენ **არ ვართ** ექიმები და არ ვაძლევთ სამედიცინო რჩევებს.\n\n` +
                `✅ რას ვაკეთებთ:\n` +
                `• სამეცნიერო კვლევების მოძიება\n` +
                `• ინფორმაციის თარგმნა\n` +
                `• ექიმთან საუბრისთვის მომზადება\n\n` +
                `🏥 **ყოველთვის მიმართეთ კვალიფიციურ ექიმს!**`
            ]
        },
        
        about: {
            keywords: ['ვინ ხართ', 'შესახებ', 'კომპანია', 'about', 'who are you', 'company'],
            responses: [
                `🏥 **MED&გზური** - სამედიცინო კვლევების სანავიგაციო სერვისი\n\n` +
                `🎯 ჩვენი მიზანი:\n` +
                `ხელი შევუწყოთ პაციენტებს სამეცნიერო ინფორმაციის მიღებაში\n\n` +
                `📊 რას ვაკეთებთ:\n` +
                `• PubMed-ის 38M+ კვლევიდან ვპოულობთ რელევანტურს\n` +
                `• ვთარგმნით ქართულად\n` +
                `• ვეხმარებით ექიმთან ინფორმირებულ საუბარში\n\n` +
                `💙 თქვენს გვერდით ყოველ ეტაპზე!`
            ]
        },
        
        thanks: {
            keywords: ['გმადლობ', 'გმადლობთ', 'მადლობა', 'thanks', 'thank you', 'thank'],
            responses: [
                'გმადლობთ! 😊 ყოველთვის მიხარებთ! რამე სხვა რომ გაინტერესებთ, მზად ვარ დაგეხმაროთ!',
                'არაფერს! 🙌 როგორც კი საჭიროება გექნებათ, მომმართეთ!'
            ]
        },
        
        goodbye: {
            keywords: ['ნახვამდის', 'კარგად', 'bye', 'goodbye', 'see you', 'მშვიდობით'],
            responses: [
                'ნახვამდის! 👋 ჯანმრთელობას გისურვებთ!',
                'კარგად! 🙏 თუ რამე გჭირდებათ, მზად ვარ!'
            ]
        },
        
        default: {
            responses: [
                `ბოდიში, ზუსტად ვერ გაგიგებთ. 🤔\n\n` +
                `შეგიძლიათ მკითხოთ:\n` +
                `• რა სერვისებს გთავაზობთ?\n` +
                `• რამდენი ღირს?\n` +
                `• როგორ მუშაობს?\n` +
                `• როგორ დაგიკავშირდეთ?\n\n` +
                `ან დაგვიკავშირდით პირდაპირ WhatsApp-ზე 📱`,
                
                `გთხოვთ, უფრო კონკრეტულად მომწეროთ. 💬\n\n` +
                `მაგალითად:\n` +
                `• "კვლევითი გზამკვლევი"\n` +
                `• "ფასები"\n` +
                `• "კონტაქტი"\n\n` +
                `ან დაგვიკავშირდით პირდაპირ 👇`
            ]
        }
    },

    // Initialize chatbot
    init() {
        this.createChatWidget();
        this.bindEvents();
    },

    // Create chat widget HTML
    createChatWidget() {
        const widget = document.createElement('div');
        widget.id = 'chatbot-widget';
        widget.innerHTML = `
            <div class="chatbot-container" id="chatbotContainer">
                <div class="chatbot-header">
                    <div class="chatbot-avatar">
                        <svg viewBox="0 0 32 32" fill="none">
                            <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" fill="currentColor" fill-opacity="0.2"/>
                            <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" stroke="currentColor" stroke-width="2" fill="none"/>
                            <path d="M16 8v8M12 12h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <div class="chatbot-info">
                        <div class="chatbot-name">MED&გზური AI</div>
                        <div class="chatbot-status">🟢 ონლაინ</div>
                    </div>
                    <button class="chatbot-close" id="chatbotClose">&times;</button>
                </div>
                <div class="chatbot-messages" id="chatbotMessages"></div>
                <div class="chatbot-quick-replies" id="quickReplies">
                    <button class="quick-reply" data-text="სერვისები">სერვისები</button>
                    <button class="quick-reply" data-text="ფასები">ფასები</button>
                    <button class="quick-reply" data-text="კონტაქტი">კონტაქტი</button>
                </div>
                <div class="chatbot-input-area">
                    <input type="text" class="chatbot-input" id="chatbotInput" placeholder="დაწერეთ შეტყობინება...">
                    <button class="chatbot-send" id="chatbotSend">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
            <button class="chatbot-toggle" id="chatbotToggle">
                <div class="chatbot-toggle-pulse"></div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
                <span class="chatbot-notification">1</span>
            </button>
        `;
        document.body.appendChild(widget);
        
        // Add welcome message
        setTimeout(() => {
            this.addBotMessage('გამარჯობა! 👋 მე MED&გზურის ვირტუალური ასისტენტი ვარ. რით შემიძლია დაგეხმაროთ?');
        }, 2000);
    },

    // Bind events
    bindEvents() {
        // Toggle button
        document.getElementById('chatbotToggle').addEventListener('click', () => this.toggle());
        
        // Close button
        document.getElementById('chatbotClose').addEventListener('click', () => this.close());
        
        // Send button
        document.getElementById('chatbotSend').addEventListener('click', () => this.sendMessage());
        
        // Input enter key
        document.getElementById('chatbotInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Quick replies
        document.querySelectorAll('.quick-reply').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = e.target.dataset.text;
                this.addUserMessage(text);
                this.processMessage(text);
            });
        });
    },

    // Toggle chat
    toggle() {
        this.isOpen = !this.isOpen;
        const container = document.getElementById('chatbotContainer');
        const toggle = document.getElementById('chatbotToggle');
        
        if (this.isOpen) {
            container.classList.add('open');
            toggle.classList.add('hidden');
            document.getElementById('chatbotInput').focus();
        } else {
            container.classList.remove('open');
            toggle.classList.remove('hidden');
        }
    },

    // Close chat
    close() {
        this.isOpen = false;
        document.getElementById('chatbotContainer').classList.remove('open');
        document.getElementById('chatbotToggle').classList.remove('hidden');
    },

    // Add user message
    addUserMessage(text) {
        const messagesContainer = document.getElementById('chatbotMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-user';
        messageDiv.innerHTML = `<div class="message-content">${this.escapeHtml(text)}</div>`;
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    },

    // Add bot message
    addBotMessage(text) {
        const messagesContainer = document.getElementById('chatbotMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-bot';
        messageDiv.innerHTML = `
            <div class="message-avatar">
                <svg viewBox="0 0 32 32" fill="none">
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" fill="currentColor" fill-opacity="0.2"/>
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M16 8v8M12 12h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="message-content">${text.replace(/\n/g, '<br>')}</div>
        `;
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    },

    // Add action buttons
    addActionButtons() {
        const messagesContainer = document.getElementById('chatbotMessages');
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'message message-bot';
        buttonsDiv.innerHTML = `
            <div class="message-avatar">
                <svg viewBox="0 0 32 32" fill="none">
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" fill="currentColor" fill-opacity="0.2"/>
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M16 8v8M12 12h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="message-actions">
                <a href="https://wa.me/995555145719" target="_blank" class="action-btn action-whatsapp">
                    📱 WhatsApp
                </a>
                <a href="#contact" class="action-btn action-form" onclick="ChatBot.close(); setTimeout(() => document.getElementById('contact').scrollIntoView({behavior: 'smooth'}), 300);">
                    📝 ფორმა
                </a>
            </div>
        `;
        messagesContainer.appendChild(buttonsDiv);
        this.scrollToBottom();
    },

    // Send message
    sendMessage() {
        const input = document.getElementById('chatbotInput');
        const text = input.value.trim();
        if (!text) return;
        
        this.addUserMessage(text);
        input.value = '';
        this.processMessage(text);
    },

    // Process message and generate response
    processMessage(text) {
        const lowerText = text.toLowerCase();
        
        // Find matching category
        let matchedCategory = null;
        
        for (const [category, data] of Object.entries(this.knowledgeBase)) {
            if (category === 'default') continue;
            
            const keywords = data.keywords || [];
            if (keywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
                matchedCategory = category;
                break;
            }
        }
        
        // Show typing indicator
        this.showTyping();
        
        // Generate response with delay
        setTimeout(() => {
            this.hideTyping();
            
            const category = matchedCategory || 'default';
            const responses = this.knowledgeBase[category].responses;
            const response = responses[Math.floor(Math.random() * responses.length)];
            
            this.addBotMessage(response);
            
            // Add action buttons for certain categories
            if (['services', 'researchGuide', 'activeSupport', 'translation', 'prices', 'contact', 'consultation'].includes(category)) {
                setTimeout(() => this.addActionButtons(), 500);
            }
        }, 1000 + Math.random() * 1000);
    },

    // Show typing indicator
    showTyping() {
        const messagesContainer = document.getElementById('chatbotMessages');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'message message-bot typing';
        typingDiv.innerHTML = `
            <div class="message-avatar">
                <svg viewBox="0 0 32 32" fill="none">
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" fill="currentColor" fill-opacity="0.2"/>
                    <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10z" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M16 8v8M12 12h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    },

    // Hide typing indicator
    hideTyping() {
        const typing = document.getElementById('typingIndicator');
        if (typing) typing.remove();
    },

    // Scroll to bottom
    scrollToBottom() {
        const messagesContainer = document.getElementById('chatbotMessages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    ChatBot.init();
});
