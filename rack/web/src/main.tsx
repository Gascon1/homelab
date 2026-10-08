import { render } from 'preact';
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource-variable/doto/wght.css';
import './styles.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
