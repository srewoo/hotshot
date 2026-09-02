import { render } from 'preact'
import '../tokens.css'
import { Library } from './Library'

const root = document.getElementById('root')
if (root) render(<Library />, root)
