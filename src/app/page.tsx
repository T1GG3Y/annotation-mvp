import Link from 'next/link'

const versions = [
  { href: '/f', title: 'Mobile Prototype A', subtitle: 'Bottom Toolbar', desc: 'Portrait-optimized for phones and tablets. Touch-sized controls, pinch-to-zoom, and Damage Visibility.' },
  { href: '/e', title: 'Desktop Prototype', subtitle: 'Left Sidebar', desc: 'Full-featured desktop annotation tool with Damage Visibility, legend, copy/paste, and keyboard shortcuts.' },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12 relative">
      <div className="absolute top-5 left-6">
        <img src="/jobnimbus-logo.png" alt="JobNimbus" className="h-8 w-auto" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Photo Markup</h1>
      <p className="text-zinc-400 mb-10 text-center">Pick a version to test</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
        {versions.map(({ href, title, subtitle, desc }) => (
          <Link key={href} href={href}
            className="group block p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:border-blue-500/50 hover:bg-zinc-900 transition-all">
            <div className="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">{title}</div>
            <div className="text-sm text-blue-400 mb-3">{subtitle}</div>
            <p className="text-zinc-500 text-sm leading-relaxed">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
