const { default: app1, logo, vite: app2 } = await import('/vite.svg')
// import './App.css'

function App() {
  return (
    <div>
      <h1>Manutenção Urbana PWA</h1>
      <p>Sistema de reporte de problemas de infraestrutura urbana</p>
    </div>
  )
}

export default App