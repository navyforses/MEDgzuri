export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 py-8">
      <div className="mx-auto max-w-5xl px-4 text-center text-sm text-gray-500 sm:px-6">
        <p>
          &copy; {new Date().getFullYear()} GrantKit | {" "}
          <a
            href="mailto:hello@grantkit.co"
            className="text-primary-700 hover:underline"
          >
            Contact
          </a>{" "}
          |{" "}
          <a
            href="https://YOURUSERNAME.gumroad.com/l/grantkit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 hover:underline"
          >
            Subscribe on Gumroad
          </a>
        </p>
      </div>
    </footer>
  );
}
